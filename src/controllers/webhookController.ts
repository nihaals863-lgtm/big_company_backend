import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const handlePalmKashWebhook = async (req: Request, res: Response) => {
  try {
    // DEBUG LOG Payload
    console.log('--- [PalmKash Webhook Received] ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('-----------------------------------');

    const { reference, status, transaction_id, amount, client_reference } = req.body;
    
    // PalmKash might use client_reference if that's what we sent
    const activeReference = client_reference || reference;

    console.log(`📎 [Webhook] Processing PalmKash update. Ref: ${activeReference}, ID: ${transaction_id}, Status: ${status}`);

    if (!activeReference) {
      console.warn('⚠️ [Webhook] Missing reference in payload');
      return res.status(400).json({ success: false, message: 'Missing reference' });
    }

    // Official PalmKash status is usually 'SUCCESS' or 'FAILED' or 'PENDING'
    const isSuccess = status === 'SUCCESS' || status === 'COMPLETED' || status === 'success';

    if (!isSuccess) {
       console.log(`ℹ️ [Webhook] Transaction ${activeReference} is not successful (Status: ${status}). No action taken.`);
       return res.json({ success: true, message: 'Status recognized' });
    }

    // 1. Identify what this is (TOPUP, GAS, ORD, POS)
    if (activeReference.startsWith('TOPUP-') || activeReference.startsWith('RTOP-') || activeReference.startsWith('TEST-')) {
      // Wallet Topup
      const transaction = await prisma.walletTransaction.findFirst({
        where: { reference: { contains: transaction_id || activeReference } }
      });

      if (transaction && transaction.status === 'pending') {
        console.log(`✅ [Webhook] Completing wallet topup for reference: ${activeReference}`);
        // Determine if it's Retailer or Consumer based on fields
        if (transaction.retailerId) {
            await prisma.$transaction([
              prisma.walletTransaction.update({
                where: { id: transaction.id },
                data: { status: 'completed' }
              }),
              prisma.retailerProfile.update({
                where: { id: transaction.retailerId },
                data: { walletBalance: { increment: transaction.amount } }
              })
            ]);
        } else if (transaction.walletId) {
            await prisma.$transaction([
              prisma.walletTransaction.update({
                where: { id: transaction.id },
                data: { status: 'completed' }
              }),
              prisma.wallet.update({
                where: { id: transaction.walletId },
                data: { balance: { increment: transaction.amount } }
              })
            ]);
        }
      } else {
        console.log(`ℹ️ [Webhook] Transaction ${activeReference} already processed or not found.`);
      }
    } 
    else if (activeReference.startsWith('GAS-')) {
        // Gas Topup handled via metadata in CustomerOrder
        const order = await prisma.customerOrder.findFirst({
            where: { metadata: { contains: activeReference } } 
        });
        
        if (order && order.status === 'pending') {
            console.log(`✅ [Webhook] Completing gas topup for reference: ${activeReference}`);
            await prisma.$transaction(async (tx) => {
                await tx.customerOrder.update({
                    where: { id: order.id },
                    data: { status: 'completed' }
                });
                
                // Find associated GasTopup
                const topup = await tx.gasTopup.findFirst({
                    where: { orderId: order.id.toString() }
                });
                
                if (topup) {
                    await tx.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'completed' }
                    });
                }
            });
        }
    }
    else if (activeReference.startsWith('ORD-') || activeReference.startsWith('POS-')) {
       // Retail Order or POS Sale
       const sale = await prisma.sale.findFirst({
           where: { meterId: transaction_id || activeReference } 
       });
       if (sale && sale.status === 'pending') {
           console.log(`✅ [Webhook] Completing sale for reference: ${activeReference}`);
           await prisma.sale.update({
               where: { id: sale.id },
               data: { status: 'completed' }
           });
       }
    }

    // Always respond with 200 to acknowledge
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [Webhook Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
