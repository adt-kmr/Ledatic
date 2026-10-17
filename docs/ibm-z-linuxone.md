# IBM Z / LinuxONE deployment guide (design target)

Citadel's IBM Z story is documented in the README and the FIU console's
`/admin/ibm-z` page. This directory collects the *design-target* artefacts
that describe how Citadel would be deployed on IBM LinuxONE. None of them are
wired into the default build or runtime.

## Artefacts

- `backend/app/ibm_z/` - Python package (Telum, Crypto Express, Secure
  Execution, Fabric s390x, ONNX/Snap ML, LLaMA, pervasive encryption).
  Environment-gated, no-op on non-LinuxONE hosts.
- `backend/app/services/ibm_z/` - service-layer mirrors of the above.
- `backend/Dockerfile.linuxone` - multi-arch s390x image.
- `docker-compose.linuxone.yml` - LinuxONE deployment topology.
- `blockchain/network/crypto-config-linuxone.yaml` - s390x Fabric crypto config.
- `ml/scripts/export_onnx.py` - ONNX export for Telum.
- `ml/scripts/benchmark_telum.py` - Telum vs CPU benchmark.
- `frontend/src/lib/ibmZ.ts` - client-side trust-boundary helpers.
- `frontend/src/components/ibmz/TelumBadge.tsx` - UI badge.

## Runtime behaviour

Every module probes for its IBM Z dependency and reports `available: false`
when it is absent. The application's request path never imports these
modules, so behaviour on x86 / ARM is unchanged.
