# RLD Indexer

Position tracking and market data indexer for the RLD Protocol.

## Quick Start

1. **Start PostgreSQL**:

```bash
docker-compose up -d postgres
```

2. **Configure environment**:

```bash
cp .env.example .env
# Edit .env with your RPC URL and contract addresses
```

3. **Install dependencies**:

```bash
pip install -r requirements.txt
```

4. **Run the indexer**:

```bash
python -m src.main --mode indexer
```

5. **Run the API** (separate terminal):

```bash
python -m src.main --mode api
```

## Docker

Run everything with Docker Compose:

```bash
docker-compose up -d
```

## API Endpoints

| Endpoint                          | Description          |
| --------------------------------- | -------------------- |
| `GET /api/v1/brokers/{address}`   | Get broker state     |
| `GET /api/v1/markets/{market_id}` | Get market state     |
| `GET /api/v1/brokers/at-risk`     | List at-risk brokers |
| `GET /api/v1/status`              | System status        |

## Architecture

```
indexer/
├── schema/          # PostgreSQL DDL
├── src/
│   ├── main.py      # Entry point
│   ├── indexer.py   # Block processing
│   ├── contracts.py # ABI bindings
│   ├── rpc.py       # RPC client
│   ├── handlers/    # Event handlers
│   ├── reconciliation/ # Dual-source verification
│   └── api/         # REST API
└── docker-compose.yml
```

## Safety Features

- **Dual-source reconciliation**: Compare indexed vs on-chain state
- **Reorg handling**: Detects and rolls back reorged blocks
- **Invariant checks**: Verify system-wide invariants
- **Append-only audit trail**: Immutable event log
