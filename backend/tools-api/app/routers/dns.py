"""DNS lookup endpoint.

Authoritative-style resolution via dnspython, with optional DNSSEC
validation and a small, sane allowlist of record types.
"""

import dns.resolver
import dns.dnssec
import dns.message
import dns.query
import dns.name
import dns.rdatatype
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

ALLOWED_TYPES = {
    "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "SRV", "PTR", "DS", "DNSKEY",
}
DEFAULT_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"]


class DnsReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    type: str = Field("A", min_length=1, max_length=10)
    server: str | None = Field(None, max_length=64)
    dnssec: bool = False


class DnsAnswer(BaseModel):
    type: str
    ttl: int
    data: str


class DnsRes(BaseModel):
    name: str
    type: str
    server: str
    answers: list[DnsAnswer] = []
    dnssec_validated: bool | None = None
    error: str | None = None


@router.post("/dns", response_model=DnsRes)
async def dns_query(req: DnsReq):
    rtype = req.type.upper().strip()
    if rtype not in ALLOWED_TYPES:
        raise HTTPException(400, f"unsupported record type {rtype}. Allowed: {sorted(ALLOWED_TYPES)}")

    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = [req.server] if req.server else DEFAULT_RESOLVERS
    resolver.lifetime = 5.0
    resolver.timeout = 3.0

    try:
        answer = resolver.resolve(req.name, rtype, raise_on_no_answer=False)
    except dns.resolver.NXDOMAIN:
        return DnsRes(name=req.name, type=rtype, server=resolver.nameservers[0], error="NXDOMAIN — name does not exist")
    except dns.resolver.NoAnswer:
        return DnsRes(name=req.name, type=rtype, server=resolver.nameservers[0], error=f"no {rtype} records")
    except dns.resolver.LifetimeTimeout:
        return DnsRes(name=req.name, type=rtype, server=resolver.nameservers[0], error="resolver timeout")
    except Exception as e:
        return DnsRes(name=req.name, type=rtype, server=resolver.nameservers[0], error=str(e))

    answers: list[DnsAnswer] = []
    if answer.rrset is not None:
        ttl = answer.rrset.ttl
        for r in answer:
            answers.append(DnsAnswer(type=rtype, ttl=ttl, data=r.to_text()))

    validated: bool | None = None
    if req.dnssec:
        validated = await _validate_dnssec(req.name, rtype, resolver.nameservers[0])

    return DnsRes(
        name=req.name,
        type=rtype,
        server=resolver.nameservers[0],
        answers=answers,
        dnssec_validated=validated,
    )


async def _validate_dnssec(name: str, rtype: str, server: str) -> bool | None:
    """Best-effort DNSSEC chain check. Returns True if validated, False if
    fails validation, None if we couldn't determine (no DNSKEY/RRSIG present)."""
    try:
        qname = dns.name.from_text(name)
        rdtype = dns.rdatatype.from_text(rtype)
        request = dns.message.make_query(qname, rdtype, want_dnssec=True)
        response = dns.query.udp(request, server, timeout=3.0)
        rrset = response.find_rrset(response.answer, qname, dns.rdataclass.IN, rdtype, create=False)
        rrsig = response.find_rrset(
            response.answer, qname, dns.rdataclass.IN, dns.rdatatype.RRSIG, rdtype, create=False,
        )
        # Need the DNSKEY for the zone — fetch it
        keyset = dns.resolver.resolve(name, "DNSKEY", raise_on_no_answer=False)
        if keyset.rrset is None:
            return None
        dns.dnssec.validate(rrset, rrsig, {qname: keyset.rrset})
        return True
    except (KeyError, dns.exception.DNSException):
        return None
    except dns.dnssec.ValidationFailure:
        return False
