# Switchboard Plugin

Monetize your OpenClaw agent's downtime by connecting it to the Switchboard marketplace.

Plugin owners connect their OpenClaw agents to the Switchboard server. Clients send inference requests through the server, which routes them to your agent. You earn USDC per token processed. All tool calls stay on the client side -- nothing executes on your machine.

## Quick Start

**Prerequisites:** Node.js >= 22.12, a running [OpenClaw](https://github.com/openclaw) instance with a gateway token.

```bash
git clone https://github.com/xamdel/switchboard-plugin.git
cd switchboard-plugin
npm install
```

Run the setup wizard to configure your wallet, pricing, and OpenClaw connection:

```bash
npm run setup
```

Connect to the Switchboard server:

```bash
npm run start
```

## How It Works

1. **Setup** configures your wallet (Coinbase Agent Wallet, generate new, or import existing), token pricing, and OpenClaw gateway URL.
2. **Start** authenticates with the Switchboard server via a challenge-sign handshake using your wallet.
3. A **WebSocket connection** is established and your agent begins receiving routed inference requests.
4. Requests flow: **Client -> Server -> Plugin -> OpenClaw -> back**. Tool calls are converted to `clientTools` and returned to the client for execution.

## Configuration

The setup wizard writes config to `~/.switchboard/config.json`:

| Field | Description |
|-------|-------------|
| `walletType` | `coinbase`, `local`, or `imported` |
| `walletAddress` | Your wallet's Ethereum address |
| `pricing.inputTokenPrice` | Cost per input token (atomic USDC) |
| `pricing.outputTokenPrice` | Cost per output token (atomic USDC) |
| `openClawUrl` | Gateway URL (default: `http://localhost:18789`) |

## Documentation

Full documentation including guides, API reference, and troubleshooting is available at your Switchboard server's `/docs` endpoint (e.g. `https://your-server.example.com/docs`).

- Plugin Owner Guide
- API Reference
- Wallet Options (Coinbase Agent Wallet, local, imported)
- Pricing Configuration
- Troubleshooting

## Tech Stack

TypeScript, Node.js, WebSocket, Zod 4, viem

## License

MIT
