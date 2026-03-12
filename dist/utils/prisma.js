"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
// Create Prisma client with connection pool settings for Railway
const prisma = new client_1.PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URI,
        },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
// Helper function to retry database operations
function withRetry(operation_1) {
    return __awaiter(this, arguments, void 0, function* (operation, retries = MAX_RETRIES) {
        var _a;
        try {
            return yield operation();
        }
        catch (error) {
            if (retries > 0 && ((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('Server has closed the connection'))) {
                console.log(`Database connection lost, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
                yield new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                // Attempt to reconnect
                try {
                    yield prisma.$disconnect();
                    yield prisma.$connect();
                }
                catch (reconnectError) {
                    console.error('Reconnection attempt failed:', reconnectError);
                }
                return withRetry(operation, retries - 1);
            }
            throw error;
        }
    });
}
// Initial connection with retry
const connectWithRetry = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            yield prisma.$connect();
            console.log('✅ Database connected successfully');
            return;
        }
        catch (error) {
            console.error(`❌ Database connection attempt ${i + 1} failed:`, error);
            if (i < attempts - 1) {
                console.log(`Retrying in ${RETRY_DELAY}ms...`);
                yield new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }
    console.error('❌ All database connection attempts failed');
});
// Connect on startup
connectWithRetry();
// Graceful shutdown
process.on('beforeExit', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
exports.default = prisma;
