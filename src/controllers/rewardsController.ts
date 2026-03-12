import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';

// Get rewards balance (general rewards, not gas rewards)
export const getRewardsBalance = async (req: AuthRequest, res: Response) => {
    try {
        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId: req.user!.id }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }

        // Calculate lifetime points from gas rewards
        const gasRewards = await prisma.gasReward.findMany({
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
    } catch (error: any) {
        console.error('Get rewards balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get rewards history
export const getRewardsHistory = async (req: AuthRequest, res: Response) => {
    try {
        const { limit = 20 } = req.query;
        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId: req.user!.id }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }

        // Get gas rewards as transactions
        const gasRewards = await prisma.gasReward.findMany({
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
    } catch (error: any) {
        console.error('Get rewards history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get referral code
export const getReferralCode = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id }
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
    } catch (error: any) {
        console.error('Get referral code error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Apply referral code
export const applyReferralCode = async (req: AuthRequest, res: Response) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, error: 'Referral code is required' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId: req.user!.id }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }

        // Award referral bonus (50 m3)
        await prisma.gasReward.create({
            data: {
                consumerId: consumerProfile.id,
                units: 50,
                source: 'referral',
                reference: code
            }
        });

        // Update rewards points
        await prisma.consumerProfile.update({
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
    } catch (error: any) {
        console.error('Apply referral code error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get leaderboard
export const getLeaderboard = async (req: AuthRequest, res: Response) => {
    try {
        const { period = 'month' } = req.query;

        // Calculate date filter based on period
        let dateFilter: Date | undefined;
        const now = new Date();

        if (period === 'week') {
            dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (period === 'month') {
            dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Get all rewards with filter
        const rewards = await prisma.gasReward.findMany({
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
        const leaderboardMap = rewards.reduce((acc: any, reward) => {
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
        leaderboard.sort((a: any, b: any) => b.points - a.points);

        // Add rank and tier
        leaderboard = leaderboard.slice(0, 10).map((item: any, index) => ({
            rank: index + 1,
            name: item.name,
            points: item.points,
            tier: item.points > 10000 ? 'PLATINUM' : item.points > 5000 ? 'GOLD' : 'SILVER',
            is_current_user: item.userId === req.user!.id
        }));

        res.json({
            success: true,
            data: {
                leaderboard
            }
        });
    } catch (error: any) {
        console.error('Get leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Redeem rewards
export const redeemRewards = async (req: AuthRequest, res: Response) => {
    try {
        const { points } = req.body;

        if (!points || points < 100) {
            return res.status(400).json({ success: false, error: 'Minimum 100 points required to redeem' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId: req.user!.id }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Consumer profile not found' });
        }

        if (consumerProfile.rewardsPoints < points) {
            return res.status(400).json({ success: false, error: 'Insufficient points' });
        }

        // Get or create dashboard wallet
        let wallet = await prisma.wallet.findFirst({
            where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
        });

        if (!wallet) {
            wallet = await prisma.wallet.create({
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
        await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: rwfAmount } }
        });

        // Create wallet transaction
        await prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: 'credit',
                amount: rwfAmount,
                description: `Redeemed ${points} reward points`,
                status: 'completed'
            }
        });

        // Deduct points from consumer profile
        await prisma.consumerProfile.update({
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
    } catch (error: any) {
        console.error('Redeem rewards error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Send rewards to meter POINTER
export const sendToMeter = async (req: AuthRequest, res: Response) => {
    try {
        const { meterId, amount } = req.body;
        const userId = req.user!.id;

        // Validation 1: Positive amount
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
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
                targetMeter = await prisma.gasMeter.findUnique({ where: { id: parseInt(meterId) } });
            }
            else if (!isNaN(parseInt(meterId))) {
                // Try ID first
                targetMeter = await prisma.gasMeter.findUnique({ where: { id: parseInt(meterId) } });
            }

            if (!targetMeter) {
                // Try Meter Number
                targetMeter = await prisma.gasMeter.findUnique({ where: { meterNumber: meterId.toString() } });
            }
        }

        if (!targetMeter) {
            return res.status(404).json({ success: false, error: 'Meter not found' });
        }

        // Validation 3: Balance check
        const gasRewards = await prisma.gasReward.findMany({
            where: { consumerId: consumerProfile.id }
        });
        const totalUnits = gasRewards.reduce((sum, r) => sum + r.units, 0);

        if (amount > totalUnits) {
            return res.status(400).json({ success: false, error: `Insufficient balance. Available: ${totalUnits} m³` });
        }

        // Atomic Transaction
        await prisma.$transaction(async (prisma) => {
            // 1. Deduct from GasReward
            // Generate Unique Ref ID: GR-<timestamp>-<userId>-<random>
            const refId = `GR-${Date.now()}-${userId}-${Math.floor(Math.random() * 10000)}`;

            await prisma.gasReward.create({
                data: {
                    consumerId: consumerProfile.id,
                    units: -amount,
                    source: 'sent',
                    reference: refId,
                    meterId: targetMeter.meterNumber
                }
            });

            // 2. Credit GasMeter
            await prisma.gasMeter.update({
                where: { id: targetMeter.id },
                data: {
                    currentUnits: { increment: amount }
                }
            });
        });

        res.json({ success: true, message: `Successfully sent ${amount} m³ to Meter ${targetMeter.meterNumber}` });

    } catch (error: any) {
        console.error('Send to meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
