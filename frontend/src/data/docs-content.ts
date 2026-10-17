import { type LucideIcon } from "lucide-react";
import {
  Rocket,
  Code,
  Puzzle,
  Brain,
  Server,
  Layers,
  Map,
} from "lucide-react";

export interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  subsections: DocSubsection[];
}

export interface DocSubsection {
  id: string;
  title: string;
  content: DocBlock[];
}

export type DocBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "code"; language: string; code: string; filename?: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; variant: "info" | "warning" | "tip"; text: string }
  | { type: "card"; title: string; description: string; icon: string };

export const docSections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Rocket,
    description: "Quick start guide to get Citadel running in minutes.",
    subsections: [
      {
        id: "prerequisites",
        title: "Prerequisites",
        content: [
          {
            type: "paragraph",
            text: "Before you begin, ensure you have the following installed on your system:",
          },
          {
            type: "list",
            items: [
              "Docker and Docker Compose v2",
              "Node.js 18+ (for frontend development)",
              "Python 3.10+ (for backend/ML development)",
              "Git",
            ],
          },
          {
            type: "callout",
            variant: "info",
            text: "For hackathon judges: You only need Docker installed. The make demo command handles everything else automatically.",
          },
        ],
      },
      {
        id: "installation",
        title: "Installation",
        content: [
          {
            type: "paragraph",
            text: "Clone the repository and start the entire stack with a single command:",
          },
          {
            type: "code",
            language: "bash",
            filename: "terminal",
            code: `git clone https://github.com/HarshdeepAthawale/Derby-Hack.git
cd Derby-Hack
make demo        # or: ./start.sh`,
          },
          {
            type: "paragraph",
            text: "This builds and starts the entire stack — Postgres, Redis, ML service, CAMARA mock, backend, frontend, and the Hyperledger Fabric network. The first run takes 3-5 minutes for image builds.",
          },
        ],
      },
      {
        id: "first-run",
        title: "First Run",
        content: [
          {
            type: "paragraph",
            text: "Once the startup completes, open http://localhost:5173 and log in with these demo credentials:",
          },
          {
            type: "code",
            language: "text",
            filename: "demo-credentials",
            code: `Customer ID: Harsh    Password: Harsh@2026    Name: Harsh Athawale
Customer ID: Deepesh  Password: Deepesh@2026  Name: Deepesh`,
          },
          {
            type: "paragraph",
            text: "On the login page, click 'Run All 3 Scenarios' to execute the three attack simulations:",
          },
          {
            type: "list",
            items: [
              "Legitimate User → APPROVE",
              "SIM Swap → on-chain HARD_BLOCK",
              "Coercion → behavioral HARD_BLOCK",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "architecture",
    title: "Architecture",
    icon: Layers,
    description: "System overview, data flow, and component breakdown.",
    subsections: [
      {
        id: "overview",
        title: "System Overview",
        content: [
          {
            type: "paragraph",
            text: "Citadel is built on six layers with three decision pathways. The system captures behavioral signals from the first keypress and makes real-time risk decisions.",
          },
          {
            type: "card",
            title: "Client SDK Layer",
            description: "Captures keystroke dynamics, mouse movements, touch patterns, and navigation behavior on-device.",
            icon: "layers",
          },
          {
            type: "card",
            title: "Backend API Layer",
            description: "FastAPI server handling authentication, signal processing, and risk scoring.",
            icon: "server",
          },
          {
            type: "card",
            title: "ML Inference Layer",
            description: "STDAT Transformer (BehaveFormer), Siamese network, and CNN-LSTM ensemble for behavioral pattern recognition.",
            icon: "brain",
          },
          {
            type: "card",
            title: "Blockchain Layer",
            description: "Hyperledger Fabric for IMEI tracking and SIM-swap detection.",
            icon: "database",
          },
        ],
      },
      {
        id: "data-flow",
        title: "Data Flow",
        content: [
          {
            type: "paragraph",
            text: "The authentication flow follows this sequence:",
          },
          {
            type: "list",
            items: [
              "User begins typing login credentials — SDK captures from first keypress",
              "IMEI hash checked against Hyperledger Fabric ledger (<80ms, SIM swap blocked)",
              "Signals bundled and sent to backend every 500ms",
              "3-pathway decision engine processes through ML ensemble",
              "Risk score (0-1000) determines authentication decision",
              "Decision: APPROVE (0-299), STEP-UP (300-599), or HARD BLOCK (600+)",
              "On HARD BLOCK: LangChain investigative agent generates fraud report (<5s)",
            ],
          },
          {
            type: "code",
            language: "typescript",
            filename: "behavioral-signal-flow.ts",
            code: `// Signal capture → Processing → Decision
const signalBundle = {
  keystroke: { dwellTimes, flightTimes, patterns },
  mouse: { velocity, acceleration, clickPatterns },
  touch: { pressure, area, gesturePatterns },
  navigation: { timing, sequence, dwellTimes }
};

// Risk scoring
const riskScore = await mlService.analyze(signalBundle);
// 0-299: APPROVE | 300-599: STEP-UP | 600+: HARD BLOCK`,
          },
        ],
      },
      {
        id: "components",
        title: "Component Breakdown",
        content: [
          {
            type: "paragraph",
            text: "The system consists of these core components:",
          },
          {
            type: "list",
            items: [
              "Frontend: React + Vite SPA with behavioral signal capture",
              "Backend: Python FastAPI with JWT authentication and 3-pathway decision engine",
              "ML Service: STDAT Transformer (BehaveFormer) + Siamese + CNN-LSTM ensemble",
              "Blockchain: Hyperledger Fabric chaincodes (HashRegistrar, MismatchDetector, MuleDetector)",
              "Database: PostgreSQL for user data, Redis for caching",
              "SDK: Embeddable JavaScript library with 40+ behavioral signal capture",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "api-reference",
    title: "API Reference",
    icon: Code,
    description: "Backend API endpoints, authentication, and request/response formats.",
    subsections: [
      {
        id: "authentication",
        title: "Authentication",
        content: [
          {
            type: "paragraph",
            text: "All API requests require JWT authentication. The token is obtained through the login endpoint and must be included in the Authorization header.",
          },
          {
            type: "code",
            language: "http",
            filename: "auth-header",
            code: `POST /api/auth/login
Content-Type: application/json

{
  "customer_id": "Harsh",
  "password": "Harsh@2026"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "Harsh", "name": "Harsh Athawale" }
}`,
          },
          {
            type: "callout",
            variant: "tip",
            text: "Include the token in all subsequent requests: Authorization: Bearer <token>",
          },
        ],
      },
      {
        id: "endpoints",
        title: "Core Endpoints",
        content: [
          {
            type: "paragraph",
            text: "The backend exposes these primary endpoints:",
          },
          {
            type: "code",
            language: "http",
            filename: "api-endpoints",
            code: `# Authentication
POST   /api/auth/login          # User login
POST   /api/auth/register       # New user registration

# Behavioral Signals
POST   /api/signals             # Submit behavioral signal bundle
GET    /api/signals/:userId     # Get signal history for user

# Risk Assessment
POST   /api/risk/score          # Calculate risk score
GET    /api/risk/decisions      # Get recent risk decisions

# Passport
GET    /api/passport/:userId    # Get behavioral passport
PUT    /api/passport/:userId    # Update behavioral baseline

# Blockchain
GET    /api/blockchain/events   # Get Hyperledger events
POST   /api/blockchain/imei     # Register IMEI on chain`,
          },
        ],
      },
      {
        id: "signal-format",
        title: "Signal Format",
        content: [
          {
            type: "paragraph",
            text: "Behavioral signals are submitted as bundled JSON payloads:",
          },
          {
            type: "code",
            language: "typescript",
            filename: "signal-bundle.ts",
            code: `interface SignalBundle {
  userId: string;
  sessionId: string;
  timestamp: number;
  signals: {
    keystroke?: {
      dwellTimes: number[];      // Key press duration (ms)
      flightTimes: number[];     // Time between keys (ms)
      pressure?: number[];       // Touch pressure (mobile)
      patterns: string[];        // Detected patterns
    };
    mouse?: {
      velocity: number[];        // Movement speed
      acceleration: number[];    // Speed changes
      clickPatterns: object[];   // Click behavior
    };
    touch?: {
      pressure: number[];        // Touch pressure
      area: number[];            // Touch area (mm²)
      gesturePatterns: string[]; // Detected gestures
    };
    navigation?: {
      timing: number[];          // Page transition times
      sequence: string[];        // Navigation order
      dwellTimes: number[];      // Time on each page
    };
  };
}`,
          },
        ],
      },
    ],
  },
  {
    id: "sdk-integration",
    title: "SDK Integration",
    icon: Puzzle,
    description: "JavaScript/TypeScript SDK setup, event capture, and configuration.",
    subsections: [
      {
        id: "installation",
        title: "SDK Installation",
        content: [
          {
            type: "paragraph",
            text: "Install the BehaviorSDK package via npm:",
          },
          {
            type: "code",
            language: "bash",
            filename: "terminal",
            code: "npm install @citadel/sdk",
          },
          {
            type: "paragraph",
            text: "Or include directly via CDN:",
          },
          {
            type: "code",
            language: "html",
            filename: "index.html",
            code: `<script src="https://unpkg.com/@citadel/sdk@latest/dist/index.js"></script>`,
          },
        ],
      },
      {
        id: "basic-usage",
        title: "Basic Usage",
        content: [
          {
            type: "paragraph",
            text: "Initialize the SDK and start capturing behavioral signals:",
          },
          {
            type: "code",
            language: "typescript",
            filename: "app.ts",
            code: `import { BehaviorSDK } from '@citadel/sdk';

const sdk = new BehaviorSDK({
  userId: 'user-123',
  apiEndpoint: 'https://api.citadel.com',
  captureInterval: 500,  // Bundle flush every 500ms
  signals: ['keystroke', 'mouse', 'touch', 'navigation']
});

// Start capturing
sdk.start();

// Listen for risk decisions
sdk.on('riskDecision', (decision) => {
  console.log('Risk score:', decision.score);
  console.log('Action:', decision.action); // APPROVE, STEP-UP, HARD_BLOCK
});

// Stop capturing (e.g., on logout)
sdk.stop();`,
          },
        ],
      },
      {
        id: "configuration",
        title: "Configuration Options",
        content: [
          {
            type: "paragraph",
            text: "The SDK accepts these configuration options:",
          },
          {
            type: "code",
            language: "typescript",
            filename: "sdk-config.ts",
            code: `interface SDKConfig {
  userId: string;              // Required: User identifier
  apiEndpoint: string;         // Required: Backend API URL
  captureInterval?: number;    // Bundle flush interval (ms), default: 500
  signals?: string[];          // Signals to capture, default: all
  privacy?: {
    maskPasswords: boolean;    // Mask password input, default: true
    excludeFields: string[];  // CSS selectors to exclude
  };
  debug?: boolean;             // Enable debug logging
  onError?: (error: Error) => void;  // Error handler
}`,
          },
          {
            type: "callout",
            variant: "warning",
            text: "Always mask sensitive fields like passwords and credit card numbers. The SDK does this by default, but verify your configuration.",
          },
        ],
      },
    ],
  },
  {
    id: "behavioural-models",
    title: "Behavioural Models",
    icon: Brain,
    description: "LSTM model overview, feature extraction, and scoring thresholds.",
    subsections: [
      {
        id: "model-overview",
        title: "Model Overview",
        content: [
          {
            type: "paragraph",
            text: "Citadel uses a multi-model ensemble for behavioral authentication:",
          },
          {
            type: "card",
            title: "STDAT Transformer (BehaveFormer)",
            description: "State-of-the-art Transformer architecture from IEEE Q1 TBIOM 2024 for keystroke behavioral patterns. ROC-AUC 0.944 on open-set evaluation.",
            icon: "cpu",
          },
          {
            type: "card",
            title: "Siamese Network (3-Shot Enrollment)",
            description: "Triplet-loss metric learning for cold-start protection. New users are protected from session 1 — no 30-day baseline needed.",
            icon: "brain",
          },
          {
            type: "card",
            title: "CNN-LSTM + XGBoost Ensemble",
            description: "CNN-LSTM for mouse trajectory drift detection. XGBoost for composite risk scoring with SHAP explainability (RBI FREE-AI compliant).",
            icon: "brain",
          },
          {
            type: "paragraph",
            text: "All models work together through a 3-pathway decision engine: Smart Contract Fast Path (<80ms for SIM swap), Coercion Context Enrichment (telecom signals), and ML Full Path (<150ms for all other sessions).",
          },
        ],
      },
      {
        id: "feature-extraction",
        title: "Feature Extraction",
        content: [
          {
            type: "paragraph",
            text: "The system extracts these behavioral features from user interactions:",
          },
          {
            type: "code",
            language: "python",
            filename: "feature_extraction.py",
            code: `# Keystroke features
dwell_time = key_press_duration  # Time key is held down
flight_time = inter_key_interval  # Time between consecutive keys
digraph_pattern = (key1, key2, timing)  # Two-key combinations

# Mouse features
velocity = distance / time  # Movement speed
acceleration = Δvelocity / Δtime  # Speed changes
click_timing = time_between_clicks  # Click patterns

# Touch features (mobile)
pressure = touch_force  # Applied pressure (0-1)
area = touch_contact_area  # Contact patch size
gesture = swipe_pinch_tap  # Detected gesture type

# Navigation features
page_dwell = time_on_page  # How long user stays
transition_time = time_between_pages  # Navigation speed
sequence = [page1, page2, page3]  # Navigation order`,
          },
        ],
      },
      {
        id: "scoring",
        title: "Risk Scoring",
        content: [
          {
            type: "paragraph",
            text: "The system generates a composite risk score from 0-1000 based on behavioral similarity to the user's baseline:",
          },
          {
            type: "code",
            language: "typescript",
            filename: "risk-scoring.ts",
            code: `// Risk score calculation
const riskScore = weightedSum([
  keystrokeSimilarity * 0.35,    // 35% weight
  mousePatternSimilarity * 0.25, // 25% weight
  touchPatternSimilarity * 0.20, // 20% weight
  navigationSimilarity * 0.20    // 20% weight
]);

// Decision thresholds
if (riskScore < 300) {
  return 'APPROVE';      // Zero friction
} else if (riskScore < 600) {
  return 'STEP-UP_AUTH'; // Silent biometric re-challenge
} else {
  return 'HARD_BLOCK';   // Transaction frozen, alert analyst
}`,
          },
          {
            type: "callout",
            variant: "tip",
            text: "The scoring thresholds can be adjusted per institution based on risk tolerance. See the deployment section for configuration details.",
          },
        ],
      },
    ],
  },
  {
    id: "deployment",
    title: "Deployment",
    icon: Server,
    description: "Docker setup, cloud deployment, and environment variables.",
    subsections: [
      {
        id: "docker",
        title: "Docker Deployment",
        content: [
          {
            type: "paragraph",
            text: "The entire stack can be deployed using Docker Compose:",
          },
          {
            type: "code",
            language: "bash",
            filename: "terminal",
            code: `# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down`,
          },
          {
            type: "callout",
            variant: "info",
            text: "For production, ensure you set proper environment variables and secrets. See the environment variables section below.",
          },
        ],
      },
      {
        id: "cloud-deployment",
        title: "Cloud Deployment",
        content: [
          {
            type: "paragraph",
            text: "The system supports deployment to major cloud platforms:",
          },
          {
            type: "list",
            items: [
              "Vercel: Frontend deployment with automatic builds",
              "Railway: Backend API and ML service hosting",
              "Render: Alternative backend hosting with Docker support",
              "AWS/GCP/Azure: Full infrastructure deployment",
            ],
          },
          {
            type: "code",
            language: "bash",
            filename: "deploy-vercel.sh",
            code: `# Deploy frontend to Vercel
cd frontend
vercel --prod

# Deploy backend to Railway
cd ../backend
railway up`,
          },
        ],
      },
      {
        id: "environment",
        title: "Environment Variables",
        content: [
          {
            type: "paragraph",
            text: "Configure these environment variables for production deployment:",
          },
          {
            type: "code",
            language: "bash",
            filename: ".env.production",
            code: `# Database
DATABASE_URL=postgresql://user:pass@host:5432/citadel
REDIS_URL=redis://host:6379

# API
JWT_SECRET=your-super-secret-jwt-key
API_BASE_URL=https://api.citadel.com

# ML Service
ML_SERVICE_URL=http://ml-service:8000
MODEL_PATH=/models/behaviour_former.pt

# Blockchain
FABRIC_NETWORK=citadel-channel
FABRIC_ORDERER=orderer.citadel.com:7050

# Frontend
VITE_API_URL=https://api.citadel.com`,
          },
          {
            type: "callout",
            variant: "warning",
            text: "Never commit .env files to version control. Use .env.example as a template and add .env to .gitignore.",
          },
        ],
      },
    ],
  },
  {
    id: "roadmap",
    title: "Roadmap",
    icon: Map,
    description: "Planned enhancements and future integration milestones.",
    subsections: [
      {
        id: "mobile-sdk",
        title: "Native Mobile SDKs",
        content: [
          {
            type: "paragraph",
            text: "Phase 2 deliverables include native Android and iOS SDKs with hardware-level security:",
          },
          {
            type: "list",
            items: [
              "Android SDK: TelephonyManager for SIM state, Android Keystore for key storage, RASP (Runtime Application Self-Protection)",
              "iOS SDK: DeviceCheck API for device identity, App Attest for hardware attestation",
              "Both SDKs compute IMEI HMAC-SHA-256 on-device — raw IMEI never transmitted",
            ],
          },
          {
            type: "callout",
            variant: "info",
            text: "The current web SDK (TypeScript) provides full behavioral capture for browser-based banking. Native SDKs extend this to mobile apps with hardware-level attestation.",
          },
        ],
      },
      {
        id: "telecom-integration",
        title: "Real Telecom Integration",
        content: [
          {
            type: "paragraph",
            text: "The current CAMARA mock simulates GSMA CAMARA SNA API responses. Production integration:",
          },
          {
            type: "list",
            items: [
              "Tier 1 (Jio/Airtel/Vi): Available via GSMA CAMARA with no bilateral agreements required",
              "Tier 2 MNOs: Bilateral agreements for enriched SIM-swap signals — roadmap item for Phase 3",
              "No CDR (Call Detail Records) stored — only real-time SIM state checks",
            ],
          },
        ],
      },
      {
        id: "cross-bank",
        title: "Cross-Bank Consortium",
        content: [
          {
            type: "paragraph",
            text: "The proposal envisions a cross-bank device reputation network:",
          },
          {
            type: "list",
            items: [
              "Every joining PSB immediately inherits all prior device reputation data",
              "Network effect: fraud patterns detected at one bank protect all consortium members",
              "Blockchain audit trail provides cross-bank visibility without sharing customer PII",
            ],
          },
        ],
      },
    ],
  },
];

export function getSectionById(id: string): DocSection | undefined {
  return docSections.find((section) => section.id === id);
}

export function searchDocs(query: string): DocSection[] {
  const lowerQuery = query.toLowerCase();
  return docSections.filter(
    (section) =>
      section.title.toLowerCase().includes(lowerQuery) ||
      section.description.toLowerCase().includes(lowerQuery) ||
      section.subsections.some(
        (sub) =>
          sub.title.toLowerCase().includes(lowerQuery) ||
          sub.content.some(
            (block) =>
              (block.type === "paragraph" &&
                block.text.toLowerCase().includes(lowerQuery)) ||
              (block.type === "code" &&
                block.code.toLowerCase().includes(lowerQuery))
          )
      )
  );
}