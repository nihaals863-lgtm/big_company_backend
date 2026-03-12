"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.getGasMeterRechargeTransaction = exports.getGasMeterRechargeHistory = exports.initiateGasMeterRecharge = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const tokenMeter_service_1 = __importDefault(require("../services/tokenMeter.service"));
const pipingMeter_service_1 = __importDefault(require("../services/pipingMeter.service"));
const zhongyiMeter_service_1 = __importDefault(require("../services/zhongyiMeter.service"));
/**
 * Gas Meter Recharge Controller
 *
 * Handles the full Payment → API Call → Token/Confirmation flow.
 * Supports two meter types:
 *   - TOKEN  → calls tokenMeterService, returns generated recharge token
 *   - PIPING → calls pipingMeterService, performs direct credit + returns confirmation
 */
/**
 * POST /gas-recharge/initiate
 *
 * Body: { meterNumber, meterType, amount, paymentMethod, phone? }
 * meterType: "TOKEN" | "PIPING"
 * paymentMethod: "wallet" | "mobile_money" | "nfc_card"
 */
const initiateGasMeterRecharge = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { meterType, amount, paymentMethod, phone, cardId, provider, // 'stronpower' (default) | 'zhongyi'
    isVendByUnit, // New: true = unit-based, false = money-based
     } = req.body;
    // Always sanitize — trim whitespace, remove any MTR- prefix
    const meterNumber = String(req.body.meterNumber || '').trim().replace(/^MTR-/i, '');
    const customerRef = `GASRCH-${meterType}-${Date.now()}`;
    const selectedProvider = (provider || 'stronpower').toLowerCase();
    // --- Validate required fields ---
    if (!meterNumber || !meterType || !amount) {
        return res.status(400).json({
            success: false,
            error: 'meterNumber, meterType, and amount are required.',
        });
    }
    if (!['TOKEN', 'PIPING'].includes(meterType)) {
        return res.status(400).json({
            success: false,
            error: "meterType must be 'TOKEN' or 'PIPING'.",
        });
    }
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Amount must be a positive number.',
        });
    }
    // Minimum recharge check (only for money-based)
    if (!isVendByUnit && parsedAmount < 500) {
        return res.status(400).json({
            success: false,
            error: 'Minimum recharge amount is 500 RWF.',
        });
    }
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    const userRole = (_b = req.user) === null || _b === void 0 ? void 0 : _b.role;
    // --- STEP 1: Process Payment ---
    let consumerProfileId = null;
    try {
        // Only deduct from wallet if authenticated and using wallet payment
        if (userId && paymentMethod === 'wallet') {
            const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
                where: { userId },
            });
            if (!consumerProfile) {
                return res.status(404).json({ success: false, error: 'Consumer profile not found. Wallet payment requires a consumer account.' });
            }
            consumerProfileId = consumerProfile.id;
            // Find effective wallet
            const wallet = yield prisma_1.default.wallet.findFirst({
                where: { consumerId: consumerProfileId, type: 'dashboard_wallet' },
            });
            const totalMoneyAmount = isVendByUnit ? parsedAmount * 1500 : parsedAmount;
            if (!wallet || wallet.balance < totalMoneyAmount) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient wallet balance. Available: ${(wallet === null || wallet === void 0 ? void 0 : wallet.balance) || 0} RWF. Required: ${totalMoneyAmount} RWF.`,
                });
            }
            // Deduct wallet balance
            yield prisma_1.default.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: totalMoneyAmount } },
            });
            // Create wallet transaction record
            yield prisma_1.default.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'gas_meter_recharge',
                    amount: -totalMoneyAmount,
                    description: `${meterType} Gas Meter Recharge (${isVendByUnit ? 'Units' : 'Money'}) - ${meterNumber}`,
                    status: 'completed',
                },
            });
        }
        else if (userId && paymentMethod === 'nfc_card') {
            if (!cardId) {
                return res.status(400).json({ success: false, error: 'cardId is required for NFC card payment.' });
            }
            const card = yield prisma_1.default.nfcCard.findFirst({
                where: { id: Number(cardId) },
            });
            const totalMoneyAmount = isVendByUnit ? parsedAmount * 1500 : parsedAmount;
            if (!card || card.balance < totalMoneyAmount) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient NFC card balance.`,
                });
            }
            yield prisma_1.default.nfcCard.update({
                where: { id: card.id },
                data: { balance: { decrement: totalMoneyAmount } },
            });
        }
        else if (paymentMethod === 'mobile_money') {
            const totalMoneyAmount = isVendByUnit ? parsedAmount * 1500 : parsedAmount;
            // Initiate PalmKash Mobile Money payment
            const palmKash = (yield Promise.resolve().then(() => __importStar(require('../services/palmKash.service')))).default;
            const pmResult = yield palmKash.initiatePayment({
                amount: totalMoneyAmount,
                phoneNumber: phone || ((_c = req.user) === null || _c === void 0 ? void 0 : _c.phone) || '',
                referenceId: customerRef,
                description: `${meterType} Gas Meter Recharge - ${meterNumber}`
            });
            if (!pmResult.success) {
                return res.status(400).json({
                    success: false,
                    error: pmResult.error || 'PalmKash payment initiation failed'
                });
            }
            console.log(`[GasRecharge] PalmKash payment initiated: ${pmResult.transactionId}`);
        }
    }
    catch (paymentError) {
        console.error('[GasRecharge] Payment deduction failed:', paymentError.message);
        return res.status(500).json({ success: false, error: `Payment processing error: ${paymentError.message}` });
    }
    // --- STEP 2: Create a PENDING transaction record ---
    let txRecord;
    try {
        txRecord = yield prisma_1.default.gasRechargeTransaction.create({
            data: {
                customerId: consumerProfileId,
                meterNumber,
                meterType,
                amount: parsedAmount,
                isVendByUnit: !!isVendByUnit,
                paymentMethod: paymentMethod || 'wallet',
                status: paymentMethod === 'mobile_money' ? 'PENDING_PAYMENT' : 'PENDING',
                apiReference: customerRef,
                operatorId: userId || null, // Track who made the call
            },
        });
    }
    catch (dbError) {
        console.error('[GasRecharge] Failed to create transaction record:', dbError.message);
        return res.status(500).json({ success: false, error: 'Failed to log recharge transaction.' });
    }
    // --- STEP 3: Call the appropriate Meter API (routed by provider) ---
    let apiResult;
    try {
        if (selectedProvider === 'zhongyi') {
            apiResult = yield zhongyiMeter_service_1.default.rechargeMeter({
                meterNumber,
                amount: parsedAmount,
                customerRef,
            });
        }
        else if (meterType === 'TOKEN') {
            apiResult = yield tokenMeter_service_1.default.rechargeTokenMeter({
                meterNumber,
                amount: parsedAmount,
                customerRef,
                isVendByUnit: !!isVendByUnit
            });
        }
        else {
            apiResult = yield pipingMeter_service_1.default.rechargePipingMeter({
                meterNumber,
                amount: parsedAmount,
                customerRef,
                customerPhone: phone,
                // Piping meter usually doesn't support unit-based vending in same way as token
            });
        }
    }
    catch (apiError) {
        yield prisma_1.default.gasRechargeTransaction.update({
            where: { id: txRecord.id },
            data: {
                status: 'FAILED',
                errorMessage: apiError.message || 'Meter API call error',
            },
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to communicate with Meter API.',
            transactionId: txRecord.id,
        });
    }
    // --- STEP 4: Update transaction with API result ---
    const finalStatus = apiResult.success ? 'SUCCESS' : 'FAILED';
    yield prisma_1.default.gasRechargeTransaction.update({
        where: { id: txRecord.id },
        data: {
            status: finalStatus,
            tokenValue: apiResult.token || null,
            apiReference: apiResult.apiReference || null,
            errorMessage: apiResult.error || null,
        },
    });
    if (apiResult.success) {
        try {
            const meter = yield prisma_1.default.gasMeter.findUnique({
                where: { meterNumber: meterNumber }
            });
            if (meter) {
                if (consumerProfileId) {
                    yield prisma_1.default.gasTopup.create({
                        data: {
                            consumerId: consumerProfileId,
                            meterId: meter.id,
                            amount: isVendByUnit ? parsedAmount * 1500 : parsedAmount,
                            units: Number(apiResult.units) || 0,
                            isVendByUnit: !!isVendByUnit,
                            status: paymentMethod === 'mobile_money' ? 'pending' : 'completed',
                            orderId: String(txRecord.id)
                        }
                    });
                }
                if (paymentMethod !== 'mobile_money') {
                    yield prisma_1.default.gasMeter.update({
                        where: { id: meter.id },
                        data: {
                            currentUnits: {
                                increment: Number(apiResult.units) || 0
                            }
                        }
                    });
                }
            }
        }
        catch (syncError) {
            console.error(`[GasRecharge] Sync error:`, syncError.message);
        }
    }
    if (!apiResult.success) {
        // Refund logic...
        if (userId && paymentMethod === 'wallet') {
            try {
                const totalMoneyAmount = isVendByUnit ? parsedAmount * 1500 : parsedAmount;
                if (!consumerProfileId)
                    return; // Cannot refund if no profile (though unlikely if payment succeeded)
                const wallet = yield prisma_1.default.wallet.findFirst({
                    where: { consumerId: consumerProfileId, type: 'dashboard_wallet' },
                });
                if (wallet) {
                    yield prisma_1.default.wallet.update({
                        where: { id: wallet.id },
                        data: { balance: { increment: totalMoneyAmount } },
                    });
                    yield prisma_1.default.walletTransaction.create({
                        data: {
                            walletId: wallet.id,
                            type: 'gas_meter_recharge_refund',
                            amount: totalMoneyAmount,
                            description: `Refund: ${meterType} Recharge failed - ${meterNumber}`,
                            status: 'completed',
                        },
                    });
                }
            }
            catch (refundError) {
                console.error('[GasRecharge] Refund failed:', refundError.message);
            }
        }
        return res.status(400).json({
            success: false,
            error: apiResult.error || 'Meter recharge failed.',
            transactionId: txRecord.id,
        });
    }
    return res.json({
        success: true,
        data: Object.assign({ transactionId: txRecord.id, meterNumber,
            meterType, amount: parsedAmount, units: apiResult.units, apiReference: apiResult.apiReference, message: apiResult.message || 'Recharge successful' }, (meterType === 'TOKEN' && { token: apiResult.token })),
    });
});
exports.initiateGasMeterRecharge = initiateGasMeterRecharge;
/**
 * GET /gas-recharge/history
 *
 * Returns recharge history for authenticated user.
 * Filters by consumerId if logged in, or returns all if admin.
 */
const getGasMeterRechargeHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        const { limit = 20, offset = 0, meterNumber } = req.query;
        let whereClause = {};
        // Filter by consumer profile if user is logged in
        if (userId) {
            const profile = yield prisma_1.default.consumerProfile.findUnique({ where: { userId } });
            if (profile) {
                whereClause.customerId = profile.id;
            }
        }
        if (meterNumber) {
            whereClause.meterNumber = { contains: String(meterNumber) };
        }
        const [transactions, total] = yield Promise.all([
            prisma_1.default.gasRechargeTransaction.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                take: Number(limit),
                skip: Number(offset),
            }),
            prisma_1.default.gasRechargeTransaction.count({ where: whereClause }),
        ]);
        return res.json({
            success: true,
            data: transactions.map((tx) => ({
                id: tx.id,
                meter_number: tx.meterNumber,
                meter_type: tx.meterType,
                amount: tx.amount,
                token_value: tx.tokenValue, // null for PIPING
                api_reference: tx.apiReference,
                status: tx.status,
                payment_method: tx.paymentMethod,
                error_message: tx.errorMessage,
                created_at: tx.createdAt,
            })),
            total,
        });
    }
    catch (error) {
        console.error('[GasRecharge] History fetch error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasMeterRechargeHistory = getGasMeterRechargeHistory;
/**
 * GET /gas-recharge/transaction/:id
 *
 * Get details of a specific recharge transaction.
 */
const getGasMeterRechargeTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const tx = yield prisma_1.default.gasRechargeTransaction.findUnique({
            where: { id: Number(id) },
        });
        if (!tx) {
            return res.status(404).json({ success: false, error: 'Transaction not found.' });
        }
        return res.json({
            success: true,
            data: {
                id: tx.id,
                meter_number: tx.meterNumber,
                meter_type: tx.meterType,
                amount: tx.amount,
                token_value: tx.tokenValue,
                api_reference: tx.apiReference,
                status: tx.status,
                payment_method: tx.paymentMethod,
                error_message: tx.errorMessage,
                created_at: tx.createdAt,
                updated_at: tx.updatedAt,
            },
        });
    }
    catch (error) {
        console.error('[GasRecharge] Transaction fetch error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasMeterRechargeTransaction = getGasMeterRechargeTransaction;
