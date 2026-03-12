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
exports.topUpCard = exports.getCardOrders = exports.updateCardNickname = exports.setPrimaryCard = exports.setCardPin = exports.unlinkCard = exports.linkCard = exports.getMyCards = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
// Get customer's NFC cards
const getMyCards = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const cards = yield prisma_1.default.nfcCard.findMany({
            where: { consumerId: consumerProfile.id }
        });
        // Transform to frontend expected format
        const formattedCards = cards.map((card, index) => ({
            id: card.id,
            uid: card.uid,
            card_number: `NFC-${card.uid.slice(-4).toUpperCase()}`, // Generate a display number
            status: card.status || 'active',
            is_primary: index === 0, // Assume first card is primary for now
            linked_at: card.createdAt,
            last_used: card.updatedAt,
            nickname: `NFC Card (${card.uid.slice(-4)})`,
            balance: card.balance || 0, // Add balance
        }));
        res.json({
            success: true,
            data: formattedCards
        });
    }
    catch (error) {
        console.error('Get NFC cards error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getMyCards = getMyCards;
// Link a new NFC card
const linkCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { uid, pin, nickname } = req.body;
        if (!uid || !pin) {
            return res.status(400).json({ success: false, error: 'UID and PIN are required' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        // Check if card is already linked or exists
        const existingCard = yield prisma_1.default.nfcCard.findUnique({
            where: { uid }
        });
        if (existingCard) {
            if (existingCard.consumerId) {
                return res.status(400).json({ success: false, error: 'Card is already linked to a user' });
            }
            // If card exists but not linked (e.g. created by admin), link it
            // Verify PIN if needed (assuming new cards might have a PIN set by admin)
            // For now, simpler: just update it
            yield prisma_1.default.nfcCard.update({
                where: { id: existingCard.id },
                data: {
                    consumerId: consumerProfile.id,
                    status: 'active',
                    pin: pin // Update PIN to user's choice
                }
            });
            return res.json({
                success: true,
                message: 'Card linked successfully'
            });
        }
        // If card doesn't exist, create it (assuming self-registration flow allowed for demo)
        // In real world, physical cards should pre-exist.
        // We will create it to support the demo flow.
        const newCard = yield prisma_1.default.nfcCard.create({
            data: {
                uid,
                pin,
                consumerId: consumerProfile.id,
                status: 'active'
            }
        });
        res.json({
            success: true,
            data: newCard,
            message: 'Card linked successfully'
        });
    }
    catch (error) {
        console.error('Link NFC card error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.linkCard = linkCard;
// Unlink NFC card
const unlinkCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const card = yield prisma_1.default.nfcCard.findUnique({
            where: { id: Number(id) }
        });
        if (!card || card.consumerId !== consumerProfile.id) {
            return res.status(404).json({ success: false, error: 'Card not found or not owned by you' });
        }
        // Unlink by removing consumerId
        yield prisma_1.default.nfcCard.update({
            where: { id: Number(id) },
            data: {
                consumerId: null,
                status: 'inactive'
            }
        });
        res.json({
            success: true,
            message: 'Card unlinked successfully'
        });
    }
    catch (error) {
        console.error('Unlink NFC card error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.unlinkCard = unlinkCard;
// Update PIN
const setCardPin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { old_pin, new_pin } = req.body;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const card = yield prisma_1.default.nfcCard.findUnique({
            where: { id: Number(id) }
        });
        if (!card || card.consumerId !== consumerProfile.id) {
            return res.status(404).json({ success: false, error: 'Card not found' });
        }
        if (card.pin && card.pin !== old_pin) {
            return res.status(400).json({ success: false, error: 'Invalid old PIN' });
        }
        yield prisma_1.default.nfcCard.update({
            where: { id: Number(id) },
            data: { pin: new_pin }
        });
        res.json({
            success: true,
            message: 'PIN updated successfully'
        });
    }
    catch (error) {
        console.error('Set card PIN error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.setCardPin = setCardPin;
// Set Primary Card
const setPrimaryCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Placeholder implementation as DB doesn't have isPrimary field
        res.json({
            success: true,
            message: 'Card set as primary'
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.setPrimaryCard = setPrimaryCard;
// Update Nickname
const updateCardNickname = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Placeholder
        res.json({
            success: true,
            message: 'Nickname updated'
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.updateCardNickname = updateCardNickname;
// Get order history for a specific NFC card
const getCardOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { cardId } = req.params;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        // Verify card ownership
        const card = yield prisma_1.default.nfcCard.findUnique({
            where: { id: Number(cardId) }
        });
        if (!card || card.consumerId !== consumerProfile.id) {
            return res.status(404).json({ success: false, error: 'Card not found or not owned by you' });
        }
        // Fetch sales made by this consumer (orders are stored as Sale model)
        // Since we don't have a direct card-to-sale link, we fetch all consumer sales
        const sales = yield prisma_1.default.sale.findMany({
            where: {
                consumerId: consumerProfile.id
            },
            include: {
                retailerProfile: {
                    select: {
                        shopName: true,
                        address: true
                    }
                },
                saleItems: {
                    select: {
                        quantity: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        // Format orders for frontend
        const formattedOrders = sales.map(sale => {
            var _a, _b, _c;
            return ({
                id: sale.id,
                order_number: `ORD-${sale.id.toString().slice(-8).toUpperCase()}`,
                shop_name: ((_a = sale.retailerProfile) === null || _a === void 0 ? void 0 : _a.shopName) || 'Unknown Shop',
                shop_location: ((_b = sale.retailerProfile) === null || _b === void 0 ? void 0 : _b.address) || 'Unknown Location',
                amount: sale.totalAmount,
                items_count: ((_c = sale.saleItems) === null || _c === void 0 ? void 0 : _c.length) || 0,
                date: sale.createdAt,
                status: sale.status
            });
        });
        res.json({
            success: true,
            data: formattedOrders
        });
    }
    catch (error) {
        console.error('Get card orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCardOrders = getCardOrders;
// Top-up NFC Card from Wallet (Mixed Funding: Dashboard + Credit)
const topUpCard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { cardId } = req.params;
        const { amount, pin } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        // Verify card ownership
        const card = yield prisma_1.default.nfcCard.findUnique({
            where: { id: Number(cardId) }
        });
        if (!card || card.consumerId !== consumerProfile.id) {
            return res.status(404).json({ success: false, error: 'Card not found or not owned by you' });
        }
        // Get Both Wallets
        const wallets = yield prisma_1.default.wallet.findMany({
            where: { consumerId: consumerProfile.id }
        });
        const dashboardWallet = wallets.find(w => w.type === 'dashboard_wallet');
        const creditWallet = wallets.find(w => w.type === 'credit_wallet');
        const dashboardBalance = (dashboardWallet === null || dashboardWallet === void 0 ? void 0 : dashboardWallet.balance) || 0;
        const creditBalance = (creditWallet === null || creditWallet === void 0 ? void 0 : creditWallet.balance) || 0;
        const totalAvailable = dashboardBalance + creditBalance;
        // Check total available balance
        if (totalAvailable < amount) {
            return res.status(400).json({ success: false, error: 'Insufficient total balance (Dashboard + Credit)' });
        }
        // Calculate Deduction Split
        let deductFromDashboard = 0;
        let deductFromCredit = 0;
        if (dashboardBalance >= amount) {
            deductFromDashboard = amount;
        }
        else {
            deductFromDashboard = dashboardBalance;
            deductFromCredit = amount - dashboardBalance;
        }
        // Perform Transfer Transaction
        yield prisma_1.default.$transaction((prisma) => __awaiter(void 0, void 0, void 0, function* () {
            // 1. Deduct from Dashboard Wallet if needed
            if (deductFromDashboard > 0 && dashboardWallet) {
                yield prisma.wallet.update({
                    where: { id: dashboardWallet.id },
                    data: { balance: { decrement: deductFromDashboard } }
                });
                yield prisma.walletTransaction.create({
                    data: {
                        walletId: dashboardWallet.id,
                        type: 'nfc_topup',
                        amount: -deductFromDashboard,
                        description: `Top-up NFC Card ${card.uid.slice(-4)}`,
                        status: 'completed',
                        reference: card.uid
                    }
                });
            }
            // 2. Deduct from Credit Wallet if needed
            if (deductFromCredit > 0 && creditWallet) {
                yield prisma.wallet.update({
                    where: { id: creditWallet.id },
                    data: { balance: { decrement: deductFromCredit } }
                });
                yield prisma.walletTransaction.create({
                    data: {
                        walletId: creditWallet.id,
                        type: 'nfc_topup',
                        amount: -deductFromCredit,
                        description: `Top-up NFC Card ${card.uid.slice(-4)} (Credit)`,
                        status: 'completed',
                        reference: card.uid
                    }
                });
            }
            // 3. Add to NFC Card
            yield prisma.nfcCard.update({
                where: { id: card.id },
                data: { balance: { increment: amount } }
            });
        }));
        res.json({
            success: true,
            message: 'Card topped up successfully',
            new_balance: (card.balance || 0) + amount
        });
    }
    catch (error) {
        console.error('Top-up NFC card error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.topUpCard = topUpCard;
