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
exports.sendToMeter = exports.redeemRewards = exports.getLeaderboard = exports.applyReferralCode = exports.getReferralCode = exports.getRewardsHistory = exports.getRewardsBalance = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
// Get rewards balance (general rewards, not gas rewards)
const getRewardsBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId: req.user.id }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }
        // Calculate lifetime points from gas rewards
        const gasRewards = yield prisma_1.default.gasReward.findMany({
            where: { consumerId: consumerProfile.id }
        });
        const lifetimePoints = gasRewards.reduce((sum, r) => sum + (r.units * 100), 0); // Convert m3 to points (1 m3 = 100 points)
        const currentPoints = consumerProfile.rewardsPoints;
        res.json({
            success: true,
            data: {
                points: currentPoints,
                lifetime_points: lifetimePoints
            }
        });
    }
    catch (error) {
        console.error('Get rewards balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRewardsBalance = getRewardsBalance;
// Get rewards history
const getRewardsHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { limit = 20 } = req.query;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId: req.user.id }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }
        // Get gas rewards as transactions
        const gasRewards = yield prisma_1.default.gasReward.findMany({
            where: { consumerId: consumerProfile.id },
            orderBy: { createdAt: 'desc' },
            take: Number(limit)
        });
        // Convert gas rewards to transaction format
        const transactions = gasRewards.map(r => ({
            id: r.id,
            type: r.source,
            points: r.units * 100, // Convert m3 to points
            description: r.source === 'purchase' ? 'Shopping rewards' :
                r.source === 'bonus' ? 'Welcome bonus' :
                    r.source === 'referral' ? 'Referral reward' :
                        r.source === 'sent' ? `Sent to Meter ${r.meterId || ''}` :
                            r.source === 'redemption' ? 'Redeemed for Credit' :
                                r.source === 'order_payment' ? 'Used for order payment' :
                                    'Gas reward',
            created_at: r.createdAt,
            meter_id: r.meterId,
            order_id: r.reference,
            metadata: {
                gas_amount: r.units,
                order_id: r.reference
            }
        }));
        res.json({
            success: true,
            data: {
                transactions
            }
        });
    }
    catch (error) {
        console.error('Get rewards history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getRewardsHistory = getRewardsHistory;
// Get referral code
const getReferralCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma_1.default.user.findUnique({
            where: { id: req.user.id }
        });
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        // Generate referral code from user ID (simple implementation)
        const referralCode = 'BIG' + user.id.toString().substring(0, 6).toUpperCase();
        res.json({
            success: true,
            data: {
                referral_code: referralCode
            }
        });
    }
    catch (error) {
        console.error('Get referral code error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getReferralCode = getReferralCode;
// Apply referral code
const applyReferralCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Referral code is required' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId: req.user.id }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }
        // Award referral bonus (50 m3)
        yield prisma_1.default.gasReward.create({
            data: {
                consumerId: consumerProfile.id,
                units: 50,
                source: 'referral',
                reference: code
            }
        });
        // Update rewards points
        yield prisma_1.default.consumerProfile.update({
            where: { id: consumerProfile.id },
            data: {
                rewardsPoints: {
                    increment: 5000 // 50 m3 = 5000 points
                }
            }
        });
        res.json({
            success: true,
            message: 'Referral code applied successfully! You earned 50 m³ of gas rewards.'
        });
    }
    catch (error) {
        console.error('Apply referral code error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.applyReferralCode = applyReferralCode;
// Get leaderboard
const getLeaderboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { period = 'month' } = req.query;
        // Calculate date filter based on period
        let dateFilter;
        const now = new Date();
        if (period === 'week') {
            dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        else if (period === 'month') {
            dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        // Get all rewards with filter
        const rewards = yield prisma_1.default.gasReward.findMany({
            where: dateFilter ? { createdAt: { gte: dateFilter } } : {},
            include: {
                consumerProfile: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                id: true
                            }
                        }
                    }
                }
            }
        });
        // Group by consumer and sum units
        const leaderboardMap = rewards.reduce((acc, reward) => {
            const consumerId = reward.consumerId;
            if (!acc[consumerId]) {
                acc[consumerId] = {
                    consumerId,
                    name: reward.consumerProfile.user.name || 'Anonymous',
                    userId: reward.consumerProfile.user.id,
                    points: 0
                };
            }
            acc[consumerId].points += reward.units * 100; // Convert m3 to points
            return acc;
        }, {});
        // Convert to array and sort
        let leaderboard = Object.values(leaderboardMap);
        leaderboard.sort((a, b) => b.points - a.points);
        // Add rank and tier
        leaderboard = leaderboard.slice(0, 10).map((item, index) => ({
            rank: index + 1,
            name: item.name,
            points: item.points,
            tier: item.points > 10000 ? 'PLATINUM' : item.points > 5000 ? 'GOLD' : 'SILVER',
            is_current_user: item.userId === req.user.id
        }));
        res.json({
            success: true,
            data: {
                leaderboard
            }
        });
    }
    catch (error) {
        console.error('Get leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getLeaderboard = getLeaderboard;
// Redeem rewards
const redeemRewards = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { points } = req.body;
        if (!points || points < 100) {
            return res.status(400).json({ success: false, error: 'Minimum 100 points required to redeem' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId: req.user.id }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }
        if (consumerProfile.rewardsPoints < points) {
            return res.status(400).json({ success: false, error: 'Insufficient points' });
        }
        // Get or create dashboard wallet
        let wallet = yield prisma_1.default.wallet.findFirst({
            where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
        });
        if (!wallet) {
            wallet = yield prisma_1.default.wallet.create({
                data: {
                    consumerId: consumerProfile.id,
                    type: 'dashboard_wallet',
                    balance: 0,
                    currency: 'RWF'
                }
            });
        }
        // Convert points to RWF (1 point = 10 RWF)
        const rwfAmount = points * 10;
        // Update wallet balance
        yield prisma_1.default.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: rwfAmount } }
        });
        // Create wallet transaction
        yield prisma_1.default.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: 'credit',
                amount: rwfAmount,
                description: `Redeemed ${points} reward points`,
                status: 'completed'
            }
        });
        // Deduct points from consumer profile
        yield prisma_1.default.consumerProfile.update({
            where: { id: consumerProfile.id },
            data: {
                rewardsPoints: {
                    decrement: points
                }
            }
        });
        res.json({
            success: true,
            data: {
                points_redeemed: points,
                rwf_credited: rwfAmount,
                new_balance: wallet.balance + rwfAmount
            },
            message: `Successfully redeemed ${points} points for ${rwfAmount.toLocaleString()} RWF`
        });
    }
    catch (error) {
        console.error('Redeem rewards error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.redeemRewards = redeemRewards;
// Send rewards to meter POINTER
const sendToMeter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { meterId, amount } = req.body;
        const userId = req.user.id;
        // Validation 1: Positive amount
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }
        // Validation 2: Meter existence
        let targetMeter = null;
        if (meterId) {
            // Check if meterId is numeric ID or string Meter Number
            if (!isNaN(parseInt(meterId)) && typeof meterId !== 'string') {
                targetMeter = yield prisma_1.default.gasMeter.findUnique({ where: { id: parseInt(meterId) } });
            }
            else if (!isNaN(parseInt(meterId))) {
                // Try ID first
                targetMeter = yield prisma_1.default.gasMeter.findUnique({ where: { id: parseInt(meterId) } });
            }
            if (!targetMeter) {
                // Try Meter Number
                targetMeter = yield prisma_1.default.gasMeter.findUnique({ where: { meterNumber: meterId.toString() } });
            }
        }
        if (!targetMeter) {
            return res.status(404).json({ success: false, error: 'Meter not found' });
        }
        // Validation 3: Balance check
        const gasRewards = yield prisma_1.default.gasReward.findMany({
            where: { consumerId: consumerProfile.id }
        });
        const totalUnits = gasRewards.reduce((sum, r) => sum + r.units, 0);
        if (amount > totalUnits) {
            return res.status(400).json({ success: false, error: `Insufficient balance. Available: ${totalUnits} m³` });
        }
        // Atomic Transaction
        yield prisma_1.default.$transaction((prisma) => __awaiter(void 0, void 0, void 0, function* () {
            // 1. Deduct from GasReward
            // Generate Unique Ref ID: GR-<timestamp>-<userId>-<random>
            const refId = `GR-${Date.now()}-${userId}-${Math.floor(Math.random() * 10000)}`;
            yield prisma.gasReward.create({
                data: {
                    consumerId: consumerProfile.id,
                    units: -amount,
                    source: 'sent',
                    reference: refId,
                    meterId: targetMeter.meterNumber
                }
            });
            // 2. Credit GasMeter
            yield prisma.gasMeter.update({
                where: { id: targetMeter.id },
                data: {
                    currentUnits: { increment: amount }
                }
            });
        }));
        res.json({ success: true, message: `Successfully sent ${amount} m³ to Meter ${targetMeter.meterNumber}` });
    }
    catch (error) {
        console.error('Send to meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.sendToMeter = sendToMeter;
