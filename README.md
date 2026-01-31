# Ajoti Backend

Ajoti backend service built with NestJS and TypeScript. Provides the core API infrastructure for trust scoring and creditworthiness services.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js** | Runtime environment - async I/O, large ecosystem |
| **TypeScript** | Type safety, better DX, compile-time error catching |
| **NestJS** | Enterprise-grade framework with modular architecture |
| **PostgreSQL** | Robust relational database for financial data integrity |
| **Prisma** | Type-safe ORM with excellent migration support |
| **REST API** | Industry standard, simple to consume and document |

### Why This Stack?

- **NestJS**: Provides dependency injection, modular architecture, and built-in support for validation, guards, and interceptors - essential for fintech applications
- **Prisma**: Type-safe database access with auto-generated types, reducing runtime errors
- **PostgreSQL**: ACID compliance crucial for financial transactions and data integrity
- **TypeScript**: Catches errors at compile-time, essential for financial applications

## Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended) or npm
- PostgreSQL 14+

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd ajoti-backend
pnpm install
```

### 2. Environment Setup

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your database credentials
```

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |
| `DATABASE_URL` | PostgreSQL connection string | - |

### 3. Database Setup

```bash
# Generate Prisma client
pnpm prisma:generate

# Run migrations (when you have models)
pnpm prisma:migrate:dev

# View database in browser
pnpm prisma:studio

# Create Superadmin
pnpm exec ts-node prisma/seed.ts
```

### 4. Run the Application

```bash
# Development mode (with hot reload)
pnpm start:dev

# Production build
pnpm build
pnpm start:prod
```

### 5. Verify Installation

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "ajoti-backend",
  "version": "0.0.1"
}
```

## Project Structure

```
ajoti-backend/
├── prisma/
│   └── schema.prisma         # Database schema
├── src/
│   ├── common/               # Shared utilities
│   │   ├── decorators/       # Custom decorators
│   │   ├── filters/          # Exception filters
│   │   ├── guards/           # Auth guards
│   │   ├── interceptors/     # Request/response interceptors
│   │   ├── pipes/            # Validation pipes
│   │   └── utils/            # Utility functions
│   ├── config/               # Configuration files
│   │   └── app.config.ts     # App configuration
│   ├── modules/              # Feature modules
│   │   ├── auth/             # Authentication (future)
│   │   ├── users/            # User management (future)
│   │   ├── trust-score/      # Trust scoring (future)
│   │   ├── creditworthiness/ # Credit analysis (future)
│   │   ├── loans/            # Loan management (future)
│   │   ├── payments/         # Payment processing (future)
│   │   └── health/           # Health check endpoint
│   ├── prisma/               # Prisma service
│   ├── app.module.ts         # Root module
│   └── main.ts               # Application entry point
├── test/                     # E2E tests
├── .env.example              # Environment template
├── .eslintrc.js              # ESLint configuration
├── .prettierrc               # Prettier configuration
├── nest-cli.json             # NestJS CLI config
├── tsconfig.json             # TypeScript config
└── package.json              # Dependencies
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Start the application |
| `pnpm start:dev` | Start with hot reload |
| `pnpm start:debug` | Start with debugger |
| `pnpm start:prod` | Start production build |
| `pnpm build` | Build for production |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:migrate:dev` | Run migrations (dev) |
| `pnpm prisma:studio` | Open Prisma Studio |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

All other endpoints will be prefixed with `/api`.

## Adding a New Module

1. Create module folder in `src/modules/`
2. Create the module, controller, and service files
3. Import the module in `app.module.ts`

Example structure:
```
src/modules/example/
├── dto/
│   └── example.dto.ts
├── example.controller.ts
├── example.module.ts
├── example.service.ts
└── index.ts
```

## Code Style

- ESLint + Prettier configured
- Absolute imports via `@/` prefix
- Single quotes, trailing commas
- 100 character line width

## License

UNLICENSED - Private repository
