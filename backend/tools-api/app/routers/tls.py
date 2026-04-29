"""TLS / SSL certificate inspector.

Connects to host:port (default 443), pulls the live certificate chain,
and reports issuer / SAN / validity / key strength / signature alg.
Does not validate against the local trust store — we report what the
server actually presents and the client decides if that's good enough.
"""

import asyncio
import ssl
import socket
from datetime import datetime, timezone
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa, ec
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()
TIMEOUT = 8.0


class TlsReq(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    port: int = Field(443, ge=1, le=65535)


class CertInfo(BaseModel):
    subject: str
    issuer: str
    serial: str
    not_before: str
    not_after: str
    days_remaining: int
    sans: list[str] = []
    signature_algorithm: str
    key_type: str
    key_size: int | None = None
    is_self_signed: bool


class TlsRes(BaseModel):
    host: str
    port: int
    protocol: str | None = None
    cipher: str | None = None
    chain: list[CertInfo] = []
    error: str | None = None


def _name_to_str(name) -> str:
    return ", ".join(f"{a.oid._name}={a.value}" for a in name)


def _key_info(public_key) -> tuple[str, int | None]:
    if isinstance(public_key, rsa.RSAPublicKey):
        return "RSA", public_key.key_size
    if isinstance(public_key, ec.EllipticCurvePublicKey):
        return f"EC ({public_key.curve.name})", public_key.curve.key_size
    return type(public_key).__name__, None


def _cert_to_info(cert: x509.Certificate) -> CertInfo:
    sans: list[str] = []
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        sans = [str(s) for s in ext.value.get_values_for_type(x509.DNSName)]
    except x509.ExtensionNotFound:
        pass
    days = (cert.not_valid_after_utc - datetime.now(timezone.utc)).days
    key_type, key_size = _key_info(cert.public_key())
    return CertInfo(
        subject=_name_to_str(cert.subject),
        issuer=_name_to_str(cert.issuer),
        serial=format(cert.serial_number, "x"),
        not_before=cert.not_valid_before_utc.isoformat(),
        not_after=cert.not_valid_after_utc.isoformat(),
        days_remaining=days,
        sans=sans,
        signature_algorithm=cert.signature_algorithm_oid._name,
        key_type=key_type,
        key_size=key_size,
        is_self_signed=(cert.subject == cert.issuer),
    )


@router.post("/tls", response_model=TlsRes)
async def tls_inspect(req: TlsReq):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # we want to see the cert even if it's bad

    loop = asyncio.get_event_loop()

    def _connect_and_pull():
        with socket.create_connection((req.host, req.port), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=req.host) as ssock:
                der_chain = ssock.getpeercert(binary_form=True)
                proto = ssock.version()
                cipher = ssock.cipher()
                # getpeercert(binary_form=True) returns only the leaf — to get the full chain we need
                # the SSL_get_peer_cert_chain equivalent. CPython exposes get_verified_chain() (3.10+)
                # only when verification is enabled. Best-effort: leaf only is still useful.
                return der_chain, proto, cipher

        raise RuntimeError("unreachable")

    try:
        der, proto, cipher = await asyncio.wait_for(loop.run_in_executor(None, _connect_and_pull), timeout=TIMEOUT)
    except asyncio.TimeoutError:
        return TlsRes(host=req.host, port=req.port, error="connection timeout")
    except (socket.gaierror, OSError, ssl.SSLError) as e:
        return TlsRes(host=req.host, port=req.port, error=str(e))

    if der is None:
        return TlsRes(host=req.host, port=req.port, error="no certificate presented")

    cert = x509.load_der_x509_certificate(der)
    info = _cert_to_info(cert)
    return TlsRes(
        host=req.host,
        port=req.port,
        protocol=proto,
        cipher=cipher[0] if cipher else None,
        chain=[info],
    )
