import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { uploadImage } from '../utils/cloudinary';
import { hashPassword } from '../utils/auth';

// Get detailed dashboard stats
export const getDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.setHours(0, 0, 0, 0));

    // 1. Customers
    const customerTotal = await prisma.consumerProfile.count();
    const customerLast24h = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last24h } } } });
    const customerLast7d = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last7d } } } });
    const customerLast30d = await prisma.consumerProfile.count({ where: { user: { createdAt: { gte: last30d } } } });

    // 2. Orders (Sales)
    const sales = await prisma.sale.findMany();
    const orderTotal = sales.length;
    const orderPending = sales.filter(s => s.status === 'pending').length;
    const orderProcessing = sales.filter(s => s.status === 'processing').length;
    const orderDelivered = sales.filter(s => s.status === 'completed' || s.status === 'delivered').length;
    const orderCancelled = sales.filter(s => s.status === 'cancelled').length;
    const totalRevenue = sales.reduce((acc, s) => acc + s.totalAmount, 0);
    const todayOrders = sales.filter(s => s.createdAt >= todayStart).length;

    // 3. Transactions (using WalletTransaction)
    const txs = await prisma.walletTransaction.findMany({ where: { createdAt: { gte: last30d } } });
    const txTotal = await prisma.walletTransaction.count();
    const walletTopups = txs.filter(t => t.type === 'top_up').length;
    const gasPurchases = txs.filter(t => t.type === 'gas_payment' || t.type === 'gas_purchase').length;
    const nfcPayments = sales.filter(s => s.paymentMethod === 'nfc' && s.createdAt >= last30d).length;
    const totalVolume = txs.reduce((acc, t) => acc + t.amount, 0);

    // 4. Loans
    const loans = await prisma.loan.findMany();
    const loanTotal = loans.length;
    const loanPending = loans.filter(l => l.status === 'pending').length;
    const loanActive = loans.filter(l => l.status === 'active' || l.status === 'approved').length;
    const loanPaid = loans.filter(l => l.status === 'paid' || l.status === 'repaid').length;
    const loanDefaulted = loans.filter(l => l.status === 'defaulted' || l.status === 'overdue').length;
    const outstandingAmount = loans.reduce((acc, l) => l.status === 'active' ? acc + l.amount : acc, 0);

    // 5. Gas (using GasTopup or Sale with gas category)
    const gasTopups = await prisma.gasTopup.findMany();
    const gasTotalPurchases = gasTopups.length;
    const gasTotalAmount = gasTopups.reduce((acc, g) => acc + g.amount, 0);
    const gasTotalUnits = gasTopups.reduce((acc, g) => acc + g.units, 0);

    // 6. NFC Cards
    const nfcTotal = await prisma.nfcCard.count();
    const nfcActive = await prisma.nfcCard.count({ where: { status: 'active' } });
    const nfcLinked = await prisma.nfcCard.count({ where: { consumerId: { not: null } } });

    // 7. Retailers & Wholesalers
    const retailerTotal = await prisma.retailerProfile.count();
    const retailerActive = await prisma.user.count({ where: { role: 'retailer', isActive: true } });
    const retailerVerified = await prisma.retailerProfile.count({ where: { isVerified: true } });
    const wholesalerTotal = await prisma.wholesalerProfile.count();
    const wholesalerActive = await prisma.user.count({ where: { role: 'wholesaler', isActive: true } });

    // Recent Activity - Merge Sales, New Customers, Loans, and Gas Topups
    const [recentSales, recentConsumers, recentLoans, recentGas] = await Promise.all([
      prisma.sale.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          retailerProfile: { select: { shopName: true } },
          consumerProfile: { select: { fullName: true } }
        }
      }),
      prisma.consumerProfile.findMany({
        take: 5,
        orderBy: { user: { createdAt: 'desc' } },
        include: { user: true }
      }),
      prisma.loan.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { consumerProfile: true }
      }),
      prisma.gasTopup.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { consumerProfile: { select: { fullName: true } } }
      })
    ]);

    const activities: any[] = [
      ...recentSales.map(s => ({
        id: `sale-${s.id}`,
        action: 'order_placed',
        entity_type: 'order',
        description: `Order of ${s.totalAmount} RWF by ${s.consumerProfile?.fullName || 'Customer'}`,
        created_at: s.createdAt
      })),
      ...recentConsumers.map(c => ({
        id: `cust-${c.id}`,
        action: 'new_customer',
        entity_type: 'customer',
        description: `New customer ${c.fullName || c.user.name} joined`,
        created_at: c.user.createdAt
      })),
      ...recentLoans.map(l => ({
        id: `loan-${l.id}`,
        action: l.status === 'approved' ? 'loan_approved' : 'loan_requested',
        entity_type: 'loan',
        description: `Loan of ${l.amount} RWF ${l.status}`,
        created_at: l.createdAt
      })),
      ...recentGas.map(g => ({
        id: `gas-${g.id}`,
        action: 'gas_recharge',
        entity_type: 'gas',
        description: `${g.amount} RWF recharge for ${g.consumerProfile?.fullName || 'Customer'}`,
        created_at: g.createdAt
      }))
    ];

    const recentActivity = activities
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

    const dashboard = {
      customers: { total: customerTotal, last24h: customerLast24h, last7d: customerLast7d, last30d: customerLast30d },
      orders: { 
        total: orderTotal, 
        pending: orderPending, 
        processing: orderProcessing, 
        delivered: orderDelivered, 
        cancelled: orderCancelled, 
        totalRevenue,
        todayOrders
      },
      transactions: {
        total: txTotal,
        walletTopups,
        gasPurchases,
        nfcPayments,
        loanDisbursements: loanActive, // Approximate
        totalVolume
      },
      loans: {
        total: loanTotal,
        pending: loanPending,
        active: loanActive,
        paid: loanPaid,
        defaulted: loanDefaulted,
        outstandingAmount
      },
      gas: { totalPurchases: gasTotalPurchases, totalAmount: gasTotalAmount, totalUnits: gasTotalUnits },
      nfcCards: { total: nfcTotal, active: nfcActive, linked: nfcLinked },
      retailers: { total: retailerTotal, active: retailerActive, verified: retailerVerified },
      wholesalers: { total: wholesalerTotal, active: wholesalerActive },
      recentActivity
    };

    res.json({
      success: true,
      dashboard
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getReports = async (req: AuthRequest, res: Response) => {
  try {
    const { dateRange } = req.query;
    const now = new Date();
    let startDate = new Date(0); // All time default

    if (dateRange === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (dateRange === '7days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateRange === '30days') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dateRange === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    // 1. Stats based on date range
    const [sales, gasTopups] = await Promise.all([
      prisma.sale.findMany({ where: { createdAt: { gte: startDate } } }),
      prisma.gasTopup.findMany({ where: { createdAt: { gte: startDate } } })
    ]);

    const totalRevenue = sales.reduce((acc, s) => acc + s.totalAmount, 0);
    const orderTotal = sales.length;
    const gasDistributed = gasTopups.reduce((acc, g) => acc + g.units, 0);

    // 2. Global counts
    const [retailerTotal, wholesalerTotal, productTotal, customerTotal, loans] = await Promise.all([
      prisma.retailerProfile.count(),
      prisma.wholesalerProfile.count(),
      prisma.product.count(),
      prisma.consumerProfile.count(),
      prisma.loan.findMany()
    ]);

    const activeLoans = loans.filter(l => l.status === 'active' || l.status === 'approved').length;
    const pendingLoans = loans.filter(l => l.status === 'pending').length;
    const totalLoanAmount = loans.reduce((acc, l) => (l.status === 'active' || l.status === 'approved') ? acc + l.amount : acc, 0);

    // 3. Growth rate (Simple mock for now, or compare with previous period if data exists)
    const growthRate = 12.5; 

    res.json({
      success: true,
      summary: {
        totalRevenue,
        orderTotal,
        retailerTotal,
        wholesalerTotal,
        gasDistributed,
        growthRate,
        businessOverview: {
          totalProducts: productTotal,
          totalCustomers: customerTotal,
          totalSalesVolume: orderTotal, // Assuming volume means count here, or we could use total items
          avgOrderValue: orderTotal > 0 ? Math.round(totalRevenue / orderTotal) : 0
        },
        loanOverview: {
          activeLoans,
          totalLoanAmount,
          pendingApprovals: pendingLoans
        },
        targets: {
          orders: 5000,
          retailers: 200,
          gas: 2000
        }
      }
    });
  } catch (error: any) {
    console.error('Get Reports Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get customers
export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const customers = await prisma.consumerProfile.findMany({
      include: { 
        user: true,
        sales: {
          select: {
            totalAmount: true
          }
        },
        gasTopups: {
          select: {
            units: true
          }
        },
        gasMeters: {
          where: { status: { not: 'removed' } }
        }
      }
    });

    const formattedCustomers = customers.map(customer => {
      const orderCount = customer.sales.length;
      const totalSpent = customer.sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
      const gasBalance = customer.gasTopups.reduce((sum, topup) => sum + topup.units, 0).toFixed(2) + " M³";
      
      return {
        ...customer,
        orderCount,
        totalSpent,
        gasBalance
      };
    });

    res.json({ success: true, customers: formattedCustomers });
  } catch (error: any) {
    console.error('Get Customers Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customer = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        wallets: true,
        nfcCards: true,
        gasMeters: {
          where: { status: { not: 'removed' } }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, customer });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create customer (Admin only)
export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { email, phone, password, pin, first_name, last_name, full_name } = req.body;
    
    console.log('📝 Creating customer with data:', { first_name, last_name, full_name, phone, email });

    // Validate required fields
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!password && !pin) {
      return res.status(400).json({ error: 'Either password or PIN is required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone },
          ...(email ? [{ email }] : [])
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this phone or email already exists' });
    }

    // Hash password/pin
    const hashedPassword = password ? await hashPassword(password) : undefined;
    const hashedPin = pin ? await hashPassword(pin) : undefined;

    // Create user and profile in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Construct full name properly
      const fullName = full_name || 
        (first_name ? `${first_name}${last_name ? ' ' + last_name : ''}`.trim() : null);
      
      const userName = fullName || phone;

      const user = await tx.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          pin: hashedPin,
          role: 'consumer',
          name: userName,
          isActive: true
        }
      });

      const consumerProfile = await tx.consumerProfile.create({
        data: {
          userId: user.id,
          fullName: fullName
        }
      });

      return { user, consumerProfile };
    });

    res.status(201).json({ 
      success: true, 
      message: 'Customer created successfully',
      customer: {
        ...result.consumerProfile,
        user: result.user
      }
    });
  } catch (error: any) {
    console.error('Create Customer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getRetailers = async (req: AuthRequest, res: Response) => {
  try {
    const retailers = await prisma.retailerProfile.findMany({
      include: { user: true }
    });
    res.json({ success: true, retailers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create retailer
export const createRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, business_name, phone, address, credit_limit } = req.body;

    if (!email || !password || !business_name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: email, password, business_name, and phone are required' });
    }

    const existingEmail = await prisma.user.findFirst({ where: { email } });
    if (existingEmail) return res.status(400).json({ error: `Retailer with email ${email} already exists` });

    const existingPhone = await prisma.user.findFirst({ where: { phone } });
    if (existingPhone) return res.status(400).json({ error: `Retailer with phone ${phone} already exists` });

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        role: 'retailer',
        name: business_name,
        isActive: true // Default to active?
      }
    });

    await prisma.retailerProfile.create({
      data: {
        userId: user.id,
        shopName: business_name,
        address,
        creditLimit: credit_limit || 0
      }
    });

    res.json({ success: true, message: 'Retailer created successfully' });
  } catch (error: any) {
    console.error('Create Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get wholesalers
export const getWholesalers = async (req: AuthRequest, res: Response) => {
  try {
    const wholesalers = await prisma.wholesalerProfile.findMany({
      include: { user: true }
    });
    res.json({ success: true, wholesalers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create wholesaler
export const createWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, company_name, phone, address } = req.body;

    if (!email || !password || !company_name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: email, password, company_name, and phone are required' });
    }

    const existingEmail = await prisma.user.findFirst({ where: { email } });
    if (existingEmail) return res.status(400).json({ error: `Wholesaler with email ${email} already exists` });

    const existingPhone = await prisma.user.findFirst({ where: { phone } });
    if (existingPhone) return res.status(400).json({ error: `Wholesaler with phone ${phone} already exists` });

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        role: 'wholesaler',
        name: company_name,
        isActive: true
      }
    });

    await prisma.wholesalerProfile.create({
      data: {
        userId: user.id,
        companyName: company_name,
        address
      }
    });

    res.json({ success: true, message: 'Wholesaler created successfully' });
  } catch (error: any) {
    console.error('Create Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get loans
export const getLoans = async (req: AuthRequest, res: Response) => {
  try {
    const loans = await prisma.loan.findMany({
      include: {
        consumerProfile: {
          include: {
            user: true,
            wallets: true // Include wallets to access transactions
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate payment progress for each loan
    const formattedLoans = await Promise.all(loans.map(async (loan) => {
      // Get all repayment transactions for this loan
      // Check both 'loan_repayment_replenish' (dashboard wallet payments) 
      // and 'debit' from credit_wallet (credit wallet payments)
      const repaymentTransactions = await prisma.walletTransaction.findMany({
        where: {
          reference: loan.id.toString(),
          OR: [
            { type: 'loan_repayment_replenish' },
            { 
              type: 'debit',
              description: { contains: 'Loan Repayment' }
            }
          ]
        }
      });

      // Calculate total amount paid
      const amountPaid = repaymentTransactions.reduce((sum, txn) => {
        // For 'loan_repayment_replenish', amount is positive
        // For 'debit', amount is negative, so we need absolute value
        return sum + Math.abs(txn.amount);
      }, 0);

      const totalRepayable = loan.amount; // Simplified: no interest for now
      const amountRemaining = Math.max(0, totalRepayable - amountPaid);

      // Update loan status if fully paid
      let loanStatus = loan.status;
      if (amountPaid >= totalRepayable && loan.status !== 'repaid') {
        await prisma.loan.update({
          where: { id: loan.id },
          data: { status: 'repaid' }
        });
        loanStatus = 'repaid';
      }

      return {
        id: loan.id,
        user_id: loan.consumerProfile?.userId,
        user_name: loan.consumerProfile?.fullName || loan.consumerProfile?.user?.name || 'Unknown',
        user_type: 'consumer',
        amount: loan.amount,
        interest_rate: 5,
        duration_months: 1,
        monthly_payment: loan.amount,
        total_repayable: totalRepayable,
        amount_paid: amountPaid,
        amount_remaining: amountRemaining,
        status: loanStatus,
        created_at: loan.createdAt,
        due_date: loan.dueDate
      };
    }));

    res.json({ success: true, loans: formattedLoans });
  } catch (error: any) {
    console.error('Get Admin Loans Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get NFC cards
export const getNFCCards = async (req: AuthRequest, res: Response) => {
  try {
    const cards = await prisma.nfcCard.findMany({
      include: {
        consumerProfile: { include: { user: true } },
        retailerProfile: { include: { user: true } }
      }
    });

    const formattedCards = cards.map(card => ({
      id: card.id,
      uid: card.uid,
      status: card.status === 'available' ? 'active' : card.status,
      balance: card.balance,
      user_name: card.consumerProfile?.fullName || card.retailerProfile?.shopName || 'Unassigned',
      user_type: card.consumerProfile ? 'consumer' : (card.retailerProfile ? 'retailer' : undefined),
      created_at: card.createdAt,
      last_used: card.updatedAt
    }));

    res.json({ success: true, cards: formattedCards });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// CATEGORY MANAGEMENT
// ==========================================

export const getCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ success: true, categories });
  } catch (error: any) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, code } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    // Check if code exists
    if (code) {
      const existing = await prisma.category.findUnique({ where: { code } });
      if (existing) return res.status(400).json({ success: false, message: 'Category code already exists' });
    }

    const category = await prisma.category.create({
      data: {
        name,
        code: code || name.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
        description,
        isActive: true
      }
    });
    res.status(201).json({ success: true, category, message: 'Category created successfully' });
  } catch (error: any) {
    console.error('Create Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;
    const category = await prisma.category.update({
      where: { id: Number(id) },
      data: { name, code, description, isActive }
    });
    res.json({ success: true, category, message: 'Category updated successfully' });
  } catch (error: any) {
    console.error('Update Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.category.delete({ where: { id: Number(id) } });
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error: any) {
    console.error('Delete Category Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// RETAILER MANAGEMENT (Extra CRUD)
// ==========================================

export const updateRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // RetailerProfile ID
    const { business_name, email, phone, address, credit_limit, status } = req.body;

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) return res.status(404).json({ error: 'Retailer not found' });

    // Check for duplicate phone on OTHER users
    if (phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: retailer.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Phone ${phone} is already in use by another account` });
      }
    }

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: retailer.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Email ${email} is already in use by another account` });
      }
    }

    await prisma.retailerProfile.update({
      where: { id: Number(id) },
      data: {
        shopName: business_name,
        address,
        creditLimit: Number(credit_limit),
      }
    });

    if (phone || business_name || status) {
      await prisma.user.update({
        where: { id: retailer.userId },
        data: {
          phone,
          name: business_name,
          isActive: status === 'active'
        }
      });
    }

    res.json({ success: true, message: 'Retailer updated' });
  } catch (error: any) {
    console.error('Update Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (retailer) {
      // Delete profile first to satisfy FK
      await prisma.retailerProfile.delete({ where: { id: Number(id) } });
      // Then delete user
      await prisma.user.delete({ where: { id: retailer.userId } });
    }
    res.json({ success: true, message: 'Retailer deleted' });
  } catch (error: any) {
    console.error('Delete Retailer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const verifyRetailer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if retailer exists
    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found' });

    // Update isVerified status
    await prisma.retailerProfile.update({
      where: { id: Number(id) },
      data: { isVerified: true }
    });

    res.json({ success: true, message: 'Retailer verified successfully' });
  } catch (error: any) {
    console.error('Verify Retailer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if wholesaler exists
    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) return res.status(404).json({ success: false, message: 'Wholesaler not found' });

    // Update isVerified status
    await prisma.wholesalerProfile.update({
      where: { id: Number(id) },
      data: { isVerified: true }
    });

    res.json({ success: true, message: 'Wholesaler verified successfully' });
  } catch (error: any) {
    console.error('Verify Wholesaler Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// WHOLESALER MANAGEMENT (Extra CRUD)
// ==========================================

export const updateWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_name, email, phone, address, status } = req.body;

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) return res.status(404).json({ error: 'Wholesaler not found' });

    // Check for duplicate phone on OTHER users
    if (phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: wholesaler.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Phone ${phone} is already in use by another account` });
      }
    }

    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: wholesaler.userId }
        }
      });
      if (existingUser) {
        return res.status(400).json({ error: `Email ${email} is already in use by another account` });
      }
    }

    await prisma.wholesalerProfile.update({
      where: { id: Number(id) },
      data: {
        companyName: company_name,
        address
      }
    });

    if (phone || company_name || status) {
      await prisma.user.update({
        where: { id: wholesaler.userId },
        data: {
          phone,
          name: company_name,
          isActive: status === 'active'
        }
      });
    }

    res.json({ success: true, message: 'Wholesaler updated' });
  } catch (error: any) {
    console.error('Update Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (wholesaler) {
      // Delete profile first to satisfy FK
      await prisma.wholesalerProfile.delete({ where: { id: Number(id) } });
      // Then delete user
      await prisma.user.delete({ where: { id: wholesaler.userId } });
    }
    res.json({ success: true, message: 'Wholesaler deleted' });
  } catch (error: any) {
    console.error('Delete Wholesaler Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const updateRetailerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;
    console.log(`Updating Retailer Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(id) } });
    if (!retailer) {
      console.log(`Retailer NOT FOUND for ID: ${id}`);
      return res.status(404).json({ error: 'Retailer not found' });
    }

    // Determine new status
    let newStatus = false;
    if (typeof isActive === 'boolean') {
      newStatus = isActive;
    } else if (status === 'active') {
      newStatus = true;
    } else if (status === 'inactive') {
      newStatus = false;
    }

    console.log(`Resolved status for User ${retailer.userId}: ${newStatus}`);

    // Update User status
    await prisma.user.update({
      where: { id: retailer.userId },
      data: {
        isActive: newStatus
      }
    });

    res.json({ success: true, message: `Retailer status updated to ${newStatus ? 'active' : 'inactive'}` });
  } catch (error: any) {
    console.error('Update Retailer Status Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateWholesalerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;
    console.log(`Updating Wholesaler Status - ID: ${id}, isActive: ${isActive}, status: ${status}`);

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(id) } });
    if (!wholesaler) {
      console.log(`Wholesaler NOT FOUND for ID: ${id}`);
      return res.status(404).json({ error: 'Wholesaler not found' });
    }

    // Determine new status
    let newStatus = false;
    if (typeof isActive === 'boolean') {
      newStatus = isActive;
    } else if (status === 'active') {
      newStatus = true;
    } else if (status === 'inactive') {
      newStatus = false;
    }

    console.log(`Resolved status for User ${wholesaler.userId}: ${newStatus}`);

    // Update User status
    await prisma.user.update({
      where: { id: wholesaler.userId },
      data: {
        isActive: newStatus
      }
    });

    res.json({ success: true, message: `Wholesaler status updated to ${newStatus ? 'active' : 'inactive'}` });
  } catch (error: any) {
    console.error('Update Wholesaler Status Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// CUSTOMER MANAGEMENT (Extra CRUD)
// ==========================================

// Note: createCustomer is now defined earlier in the file (after getCustomer)

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // ConsumerProfile ID
    const { firstName, lastName, email, phone, status } = req.body;

    const profile = await prisma.consumerProfile.findUnique({ where: { id: Number(id) } });
    if (!profile) return res.status(404).json({ error: 'Customer not found' });

    // Check if email/phone is taken by ANOTHER user
    if (email || phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          AND: [
            { id: { not: profile.userId } }, // Exclude current user
            {
              OR: [
                email ? { email } : {},
                phone ? { phone } : {}
              ]
            }
          ]
        }
      });

      if (existingUser) {
        return res.status(400).json({ error: 'Email or phone already in use by another user' });
      }
    }

    await prisma.user.update({
      where: { id: profile.userId },
      data: {
        name: `${firstName} ${lastName}`,
        email,
        phone,
        isActive: status === 'active'
      }
    });

    await prisma.consumerProfile.update({
      where: { id: Number(id) },
      data: { fullName: `${firstName} ${lastName}` }
    });

    res.json({ success: true, message: 'Customer updated' });
  } catch (error: any) {
    console.error('Update Customer Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const updateCustomerStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // ConsumerProfile ID or User ID? 
    // The frontend passes record.user.id which is the USER ID.
    // Let's assume the ID passed is the USER ID because customer status is on the User model.
    // However, consistency suggests we might pass the ConsumerProfile ID and look up the user.
    // In apiService.ts: api.put(`/admin/customers/${id}/status`, data)
    // The call in CustomerManagementPage.tsx is updateCustomerStatus(record.user.id, newStatus).
    // record.user.id IS the User ID.
    // But RESTfully, /admin/customers/:id Usually implies ConsumerProfile ID.
    // Let's check updateWholesalerStatus. It takes params.id (WholesalerProfile ID) and finds profile then user.
    // So for consistency, the frontend SHOULD pass ConsumerProfile ID, and backend looks up User.
    // BUT current frontend code passes `record.user.id`.
    // I will support BOTH or check if the ID exists as a ConsumerProfile first.
    // Actually, to be consistent with getCustomers returning ConsumerProfiles, :id should be ConsumerProfile ID.
    // I will change the frontend to pass record.id (ConsumerProfile ID) instead of record.user.id.
    // Backend implementation:
    const { status } = req.body;
    // Map status string to boolean if needed, or expect boolean 'isActive'
    // apiService sends: { status: string } from definition?
    // apiService definition: updateCustomerStatus: (id: string, data: { status: string })
    // usage in frontend: await adminApi.updateCustomerStatus(record.user.id, newStatus); 
    // Wait, newStatus is boolean.
    // Frontend: const newStatus = !record.user?.isActive; ... updateCustomerStatus(..., newStatus)
    // apiService expects object? No, logic in apiService: api.put(..., data). 
    // If I pass boolean as data, it sends request body as boolean? No, must be object.
    // Frontend usage: adminApi.updateCustomerStatus(record.user.id, newStatus)
    // API Service: updateCustomerStatus: (id, data) => api.put(..., data)
    // So frontend is passing a boolean where an object is expected? 
    // Let's check frontend again.
    // Frontend: await adminApi.updateCustomerStatus(record.user.id, newStatus);
    // apiService: updateCustomerStatus: (id: string, data: { status: string }) => ... 
    // Wait, the interface in apiService says it takes `data: { status: string }` but the implementation just passes `data`.
    // So if frontend passes a boolean, the body is just `true` or `false`.
    // I should fix the frontend to pass `{ status: newStatus ? 'active' : 'inactive' }` or `{ isActive: newStatus }`.
    // And backend should handle it.
    
    // For now, let's look for profile by ID.
    
    const profileId = Number(id);
    let profile = await prisma.consumerProfile.findUnique({ where: { id: profileId } });
    
    if (!profile) {
        // Fallback: maybe it IS a user ID?
        const user = await prisma.user.findUnique({ where: { id: profileId } });
        if (!user) return res.status(404).json({ error: 'Customer not found' });
        
        // It was a user ID
        await prisma.user.update({
            where: { id: profileId },
            data: { isActive: req.body.isActive ?? (req.body.status === 'active') }
        });
    } else {
        // It was a profile ID
        await prisma.user.update({
            where: { id: profile.userId },
            data: { isActive: req.body.isActive ?? (req.body.status === 'active') }
        });
    }

    res.json({ success: true, message: 'Customer status updated' });
  } catch (error: any) {
    console.error('Update Customer Status Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const profile = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: { wallets: true }
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Customer profile not found' });
    }

    // Manual Cascade Deletion
    await prisma.$transaction([
      // 1. Delete Wallet Transactions
      prisma.walletTransaction.deleteMany({
        where: { walletId: { in: profile.wallets.map(w => w.id) } }
      }),
      // 2. Delete Wallets
      prisma.wallet.deleteMany({ where: { consumerId: Number(id) } }),
      // 3. Delete Gas Topups and Rewards
      prisma.gasTopup.deleteMany({ where: { consumerId: Number(id) } }),
      prisma.gasReward.deleteMany({ where: { consumerId: Number(id) } }),
      // 4. Delete Gas Meters
      prisma.gasMeter.deleteMany({ where: { consumerId: Number(id) } }),
      // 5. Delete Customer Orders
      prisma.customerOrder.deleteMany({ where: { consumerId: Number(id) } }),
      // 6. Delete Loans
      prisma.loan.deleteMany({ where: { consumerId: Number(id) } }),
      // 7. Unlink or delete NFC cards (unlinking is safer if cards are reusable)
      prisma.nfcCard.updateMany({
        where: { consumerId: Number(id) },
        data: { consumerId: null, status: 'inactive' }
      }),
      // 8. Delete Sales (if they belong to this consumer)
      prisma.sale.deleteMany({ where: { consumerId: Number(id) } }),
      // 9. Delete Settings
      prisma.consumerSettings.deleteMany({ where: { consumerId: Number(id) } }),
      // 10. Delete Messages and Notifications
      prisma.message.deleteMany({
        where: { OR: [{ senderId: profile.userId }, { receiverId: profile.userId }] }
      }),
      prisma.notification.deleteMany({ where: { userId: profile.userId } }),
      // 11. Delete the profile itself
      prisma.consumerProfile.delete({ where: { id: Number(id) } }),
      // 12. Finally delete the User record
      prisma.user.delete({ where: { id: profile.userId } })
    ]);

    res.json({ success: true, message: 'Customer and all associated data deleted successfully' });
  } catch (error: any) {
    console.error('Delete Customer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all products
export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        retailerProfile: {
          select: { shopName: true }
        },
        wholesalerProfile: {
          select: { companyName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ products });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create product
export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      description,
      sku,
      category,
      price,
      costPrice,
      retailerPrice,
      stock,
      unit,
      lowStockThreshold,
      invoiceNumber,
      barcode,
      wholesalerId,
      retailerId,
      image
    } = req.body;

    // Upload to Cloudinary if image is provided as base64
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      imageUrl = await uploadImage(image);
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        sku,
        category,
        price: parseFloat(price),
        costPrice: costPrice ? parseFloat(costPrice) : null,
        retailerPrice: retailerPrice ? parseFloat(retailerPrice) : null,
        stock: parseInt(stock) || 0,
        unit,
        lowStockThreshold: lowStockThreshold ? parseInt(lowStockThreshold) : null,
        invoiceNumber,
        barcode,
        wholesalerId,
        retailerId,
        image: imageUrl,
        status: 'active'
      }
    });

    res.status(201).json({ success: true, product });
  } catch (error: any) {
    console.error('Create Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update product
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      sku,
      category,
      price,
      costPrice,
      retailerPrice,
      stock,
      unit,
      lowStockThreshold,
      invoiceNumber,
      barcode,
      status,
      image
    } = req.body;

    // Upload to Cloudinary if new image is provided as base64
    let imageUrl = image;
    if (image && image.startsWith('data:image')) {
      imageUrl = await uploadImage(image);
    }

    const product = await prisma.product.update({
      where: { id: Number(id) },
      data: {
        name,
        description,
        sku,
        category,
        price: price ? parseFloat(price) : undefined,
        costPrice: costPrice !== undefined ? (costPrice ? parseFloat(costPrice) : null) : undefined,
        retailerPrice: retailerPrice !== undefined ? (retailerPrice ? parseFloat(retailerPrice) : null) : undefined,
        stock: stock !== undefined ? parseInt(stock) : undefined,
        unit,
        lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold ? parseInt(lowStockThreshold) : null) : undefined,
        invoiceNumber,
        barcode,
        status,
        image: imageUrl
      }
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('Update Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete product
export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({ where: { id: Number(id) } });
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error: any) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ error: error.message });
  }
};


// ==========================================
// EMPLOYEE MANAGEMENT
// ==========================================

// Get All Employees
export const getEmployees = async (req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employeeProfile.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            role: true,
            isActive: true
          }
        }
      }
    });

    // Transform data for frontend
    const formattedEmployees = employees.map(emp => ({
      id: emp.id,
      userId: emp.userId,
      employeeNumber: emp.employeeNumber,
      firstName: emp.user.name ? emp.user.name.split(' ')[0] : 'Unknown', // Basic name splitting
      lastName: emp.user.name ? emp.user.name.split(' ').slice(1).join(' ') : 'Employee',
      email: emp.user.email,
      phone: emp.user.phone,
      department: emp.department,
      position: emp.position,
      salary: emp.salary,
      status: emp.status,
      dateOfJoining: emp.joiningDate,
      bankAccount: emp.bankAccount
    }));

    res.json({ employees: formattedEmployees });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create Employee
export const createEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      department,
      position,
      salary,
      dateOfJoining,
      bankAccount,
      password // Get password from request
    } = req.body;

    const fullName = `${firstName} ${lastName}`;

    // check existing
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email or phone already exists' });
    }

    // Generate random password or use default
    const finalPassword = password || 'employee123';
    const hashedPassword = await hashPassword(finalPassword);

    // Generate Employee Number (simple auto-increment logic or random)
    const count = await prisma.employeeProfile.count();
    const employeeNumber = `EMP${(count + 1).toString().padStart(3, '0')}`;

    // Transaction to create User and Profile
    const result = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.create({
        data: {
          email,
          phone,
          name: fullName,
          password: hashedPassword,
          role: 'employee',
          isActive: true
        }
      });

      const profile = await prisma.employeeProfile.create({
        data: {
          userId: user.id,
          employeeNumber,
          department,
          position,
          salary: Number(salary),
          joiningDate: new Date(dateOfJoining),
          status: 'active',
          bankAccount
        }
      });

      return { user, profile };
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employee: result
    });

  } catch (error: any) {
    console.error('Create Employee Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update Employee
export const updateEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // This is the EmployeeProfile ID
    const {
      firstName,
      lastName,
      email,
      phone,
      department,
      position,
      salary,
      status,
      dateOfJoining,
      bankAccount
    } = req.body;

    const fullName = `${firstName} ${lastName}`;

    // Find profile first
    const profile = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) },
      include: { user: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Update User and Profile
    await prisma.$transaction([
      prisma.user.update({
        where: { id: profile.userId },
        data: {
          name: fullName,
          email,
          phone,
          isActive: status === 'active'
        }
      }),
      prisma.employeeProfile.update({
        where: { id: Number(id) },
        data: {
          department,
          position,
          salary: Number(salary),
          status, // 'active', 'inactive', 'on_leave'
          joiningDate: new Date(dateOfJoining),
          bankAccount
        }
      })
    ]);

    res.json({ success: true, message: 'Employee updated successfully' });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Delete Employee
export const deleteEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // EmployeeProfile ID

    const profile = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Delete User (Cascade will handle profile deletion if configured, but let's be explicit or rely on schema)
    // In our updated schema we added onDelete: Cascade to the relation.
    // So deleting the User deletes the Profile.

    await prisma.user.delete({
      where: { id: profile.userId }
    });

    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// LOAN MANAGEMENT
// ==========================================

export const approveLoan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await prisma.$transaction(async (prisma) => {
      const loan = await prisma.loan.findUnique({
        where: { id: Number(id) },
        include: { consumerProfile: true }
      });

      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'pending') throw new Error('Loan is already processed');

      // 1. Update Loan status
      const updatedLoan = await prisma.loan.update({
        where: { id: Number(id) },
        data: {
          status: 'approved',
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      // 2. Get or Create Credit Wallet
      let creditWallet = await prisma.wallet.findFirst({
        where: { consumerId: loan.consumerId, type: 'credit_wallet' }
      });

      if (!creditWallet) {
        creditWallet = await prisma.wallet.create({
          data: {
            consumerId: loan.consumerId,
            type: 'credit_wallet',
            balance: 0,
            currency: 'RWF'
          }
        });
      }

      // 3. Add to Credit Wallet Balance
      await prisma.wallet.update({
        where: { id: creditWallet.id },
        data: { balance: { increment: loan.amount } }
      });

      // 4. Create Transaction
      await prisma.walletTransaction.create({
        data: {
          walletId: creditWallet.id,
          type: 'loan_disbursement',
          amount: loan.amount,
          description: `Loan Approved by Admin`,
          status: 'completed',
          reference: loan.id.toString()
        }
      });

      return updatedLoan;
    });

    res.json({ success: true, loan: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const rejectLoan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const loan = await prisma.loan.update({
      where: { id: Number(id) },
      data: { status: 'rejected' }
    });

    res.json({ success: true, loan });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// NFC CARD MANAGEMENT
// ==========================================

export const registerNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      uid, 
      pin, 
      cardType,
      cardholderName,
      nationalId,
      phone,
      email,
      province,
      district,
      sector,
      cell,
      streetAddress,
      landmark,
      userId // Optional: Valid User ID passed from frontend
    } = req.body;

    if (!uid) return res.status(400).json({ error: 'UID is required' });

    const existing = await prisma.nfcCard.findUnique({ where: { uid } });
    if (existing) return res.status(400).json({ error: 'NFC Card with this UID already exists' });

    // Try to link to a consumer
    let consumerId = null;
    let finalStatus = 'available';

    // 1. If userId provided explicitly
    if (userId) {
        const profile = await prisma.consumerProfile.findFirst({ where: { userId: userId } }); // Assuming userId is User model ID
        if (profile) consumerId = profile.id;
        else {
            // Maybe it WAS the consumerProfile ID?
             const profileById = await prisma.consumerProfile.findUnique({ where: { id: Number(userId) } });
             if (profileById) consumerId = profileById.id;
        }
    } 
    // 2. If no userId, try to match by phone
    else if (phone) {
        const user = await prisma.user.findFirst({ where: { phone } });
        if (user) {
            const profile = await prisma.consumerProfile.findUnique({ where: { userId: user.id } });
            if (profile) consumerId = profile.id;
        }
    }

    if (consumerId) {
        finalStatus = 'active';
    }

    const card = await prisma.nfcCard.create({
      data: {
        uid,
        pin: pin || '1234',
        status: finalStatus,
        balance: 0,
        cardType,
        cardholderName,
        nationalId,
        phone,
        email,
        province,
        district,
        sector,
        cell,
        streetAddress,
        landmark,
        consumerId: consumerId
      }
    });

    res.status(201).json({ success: true, card, message: consumerId ? 'Card registered and linked to customer' : 'Card registered successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const blockNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: { status: 'blocked' }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const activateNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: { status: 'available' }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const unlinkNFCCard = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const card = await prisma.nfcCard.update({
      where: { id: Number(id) },
      data: { 
        consumerId: null,
        retailerId: null,
        status: 'available' // Reset to available upon unlink
      }
    });
    res.json({ success: true, card });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// REPORTS
// ==========================================

export const getTransactionReport = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const txs = await prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });

    // Group by period
    const report: any[] = [];
    const grouped: Record<string, any> = {};

    txs.forEach(tx => {
      const date = new Date(tx.createdAt);
      let period = '';
      if (groupBy === 'month') {
        period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      } else {
        period = date.toISOString().split('T')[0];
      }

      // Map types to frontend expectations
      let type = tx.type;
      if (type === 'topup' || type === 'top_up') type = 'wallet_topup';
      if (type === 'gas_payment' || type === 'gas_topup') type = 'gas_purchase';
      if (type === 'loan' || type === 'disbursement') type = 'loan_disbursement';
      if (type === 'nfc') type = 'nfc_payment';

      const key = `${period}_${type}`;
      if (!grouped[key]) {
        grouped[key] = { period, type, count: 0, total_amount: 0 };
      }
      grouped[key].count += 1;
      grouped[key].total_amount += tx.amount;
    });

    res.json({ success: true, report: Object.values(grouped) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getRevenueReport = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    // Revenue comes from Sales and GasTopups
    const [sales, gasTopups] = await Promise.all([
      prisma.sale.findMany({ where, orderBy: { createdAt: 'asc' } }),
      prisma.gasTopup.findMany({ where, orderBy: { createdAt: 'asc' } })
    ]);

    const grouped: Record<string, any> = {};

    sales.forEach(s => {
      const date = new Date(s.createdAt);
      let period = groupBy === 'month' 
        ? `${date.getFullYear()}-${(date.getMonth() + 0).toString().padStart(2, '0')}` // Using 0 based or 1 based? Let's use 1 based to be consistent
        : date.toISOString().split('T')[0];
      
      // Fix month calculation to be 1-based
      if (groupBy === 'month') {
        period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      }

      if (!grouped[period]) {
        grouped[period] = { period, order_revenue: 0, order_count: 0, gas_revenue: 0, gas_count: 0 };
      }
      grouped[period].order_revenue += s.totalAmount;
      grouped[period].order_count += 1;
    });

    gasTopups.forEach(g => {
      const date = new Date(g.createdAt);
      let period = groupBy === 'month' 
        ? `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`
        : date.toISOString().split('T')[0];

      if (!grouped[period]) {
        grouped[period] = { period, order_revenue: 0, order_count: 0, gas_revenue: 0, gas_count: 0 };
      }
      grouped[period].gas_revenue += g.amount;
      grouped[period].gas_count += 1;
    });

    res.json({ success: true, orders: Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period)) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// SYSTEM CONFIGURATION
// ==========================================

export const getSystemConfig = async (req: AuthRequest, res: Response) => {
  try {
    let config = await prisma.systemConfig.findFirst();
    
    // Create default config if it doesn't exist
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          retailerShare: 60,
          companyShare: 28,
          gasRewardShare: 12,
          gasPricePerM3: 850,
          minGasTopup: 500,
          maxGasTopup: 100000,
          minWalletTopup: 500,
          maxWalletTopup: 500000,
          maxDailyTransaction: 1000000,
          maxCreditLimit: 500000
        }
      });
    }
    
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateSystemConfig = async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    let config = await prisma.systemConfig.findFirst();

    if (!config) {
      config = await prisma.systemConfig.create({ data });
    } else {
      config = await prisma.systemConfig.update({
        where: { id: config.id },
        data
      });
    }

    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// ADMIN REAL-TIME READ-ONLY ACCOUNT ACCESS
// ==========================================

// Get comprehensive real-time customer account details (READ-ONLY)
export const getCustomerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const customer = await prisma.consumerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        wallets: {
          include: {
            walletTransactions: {
              orderBy: { createdAt: 'desc' },
              take: 50
            }
          }
        },
        nfcCards: true,
        gasMeters: true,
        gasTopups: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            gasMeter: true
          }
        },
        gasRewards: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        loans: {
          orderBy: { createdAt: 'desc' }
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            retailerProfile: {
              select: { shopName: true, id: true }
            },
            saleItems: {
              include: {
                product: true
              }
            }
          }
        },
        customerOrders: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    // Calculate wallet balances
    const walletSummary = {
      dashboardWallet: customer.wallets.find(w => w.type === 'dashboard_wallet')?.balance || 0,
      rewardsWallet: customer.wallets.find(w => w.type === 'rewards_wallet')?.balance || 0,
      gasRewardsWallet: customer.wallets.find(w => w.type === 'gas_rewards_wallet')?.balance || 0,
      creditWallet: customer.wallets.find(w => w.type === 'credit_wallet')?.balance || 0
    };

    // Order statistics
    const orderStats = {
      pending: customer.sales.filter(s => s.status === 'pending').length,
      active: customer.sales.filter(s => s.status === 'processing' || s.status === 'active').length,
      completed: customer.sales.filter(s => s.status === 'completed' || s.status === 'delivered').length,
      cancelled: customer.sales.filter(s => s.status === 'cancelled').length,
      total: customer.sales.length
    };

    // Get all transactions from all wallets
    const allTransactions = customer.wallets.flatMap(w =>
      w.walletTransactions.map(t => ({
        ...t,
        walletType: w.type
      }))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Gas usage summary
    const gasUsage = {
      totalTopups: customer.gasTopups.length,
      totalAmount: customer.gasTopups.reduce((sum, g) => sum + g.amount, 0),
      totalUnits: customer.gasTopups.reduce((sum, g) => sum + g.units, 0),
      totalRewards: customer.gasRewards.reduce((sum, r) => sum + r.units, 0)
    };

    // Last order details
    const lastOrder = customer.sales.length > 0 ? customer.sales[0] : null;

    // Supplier chain - find linked retailers from sales
    const linkedRetailers = [...new Set(customer.sales.map(s => s.retailerProfile?.id).filter(Boolean))];
    const supplierChain = await prisma.retailerProfile.findMany({
      where: { id: { in: linkedRetailers as number[] } },
      include: {
        linkedWholesaler: {
          select: { id: true, companyName: true }
        }
      }
    });

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: customer.id,
          userId: customer.userId,
          fullName: customer.fullName,
          phone: customer.user.phone,
          email: customer.user.email,
          membershipType: customer.membershipType,
          isVerified: customer.isVerified,
          isActive: customer.user.isActive,
          createdAt: customer.user.createdAt
        },
        walletSummary,
        wallets: customer.wallets.map(w => ({
          id: w.id,
          type: w.type,
          balance: w.balance,
          currency: w.currency
        })),
        orderStats,
        orders: customer.sales,
        transactionHistory: allTransactions,
        nfcCards: customer.nfcCards.map(card => ({
          id: card.id,
          uid: card.uid,
          status: card.status,
          balance: card.balance,
          cardType: card.cardType,
          createdAt: card.createdAt
        })),
        gasMeters: customer.gasMeters,
        gasUsage,
        gasTopups: customer.gasTopups,
        gasRewards: customer.gasRewards,
        loans: customer.loans.map(loan => ({
          id: loan.id,
          amount: loan.amount,
          status: loan.status,
          dueDate: loan.dueDate,
          createdAt: loan.createdAt
        })),
        lastOrder,
        supplierChain: supplierChain.map(r => ({
          retailerId: r.id,
          retailerName: r.shopName,
          wholesalerId: r.linkedWholesaler?.id,
          wholesalerName: r.linkedWholesaler?.companyName
        }))
      }
    });
  } catch (error: any) {
    console.error('Get Customer Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get comprehensive real-time retailer account details (READ-ONLY)
export const getRetailerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const retailer = await prisma.retailerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        credit: true,
        linkedWholesaler: {
          select: { id: true, companyName: true, user: { select: { phone: true, email: true } } }
        },
        branches: {
          include: { terminals: true }
        },
        nfcCards: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            wholesalerProfile: { select: { companyName: true } },
            orderItems: { include: { product: true } }
          }
        },
        sales: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            consumerProfile: { select: { fullName: true } },
            saleItems: { include: { product: true } }
          }
        },
        creditRequests: {
          orderBy: { createdAt: 'desc' }
        },
        inventory: {
          take: 100
        }
      }
    });

    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    // Order statistics (orders TO wholesalers)
    const orderStats = {
      pending: retailer.orders.filter(o => o.status === 'pending').length,
      active: retailer.orders.filter(o => o.status === 'processing' || o.status === 'active').length,
      completed: retailer.orders.filter(o => o.status === 'completed' || o.status === 'delivered').length,
      cancelled: retailer.orders.filter(o => o.status === 'cancelled').length,
      total: retailer.orders.length
    };

    // Sales statistics (sales TO consumers)
    const salesStats = {
      pending: retailer.sales.filter(s => s.status === 'pending').length,
      completed: retailer.sales.filter(s => s.status === 'completed' || s.status === 'delivered').length,
      cancelled: retailer.sales.filter(s => s.status === 'cancelled').length,
      total: retailer.sales.length,
      totalRevenue: retailer.sales.reduce((sum, s) => sum + s.totalAmount, 0)
    };

    // Credit summary
    const creditSummary = retailer.credit ? {
      creditLimit: retailer.credit.creditLimit,
      usedCredit: retailer.credit.usedCredit,
      availableCredit: retailer.credit.availableCredit
    } : {
      creditLimit: retailer.creditLimit,
      usedCredit: 0,
      availableCredit: retailer.creditLimit
    };

    // Last order details
    const lastOrder = retailer.orders.length > 0 ? retailer.orders[0] : null;

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: retailer.id,
          userId: retailer.userId,
          shopName: retailer.shopName,
          address: retailer.address,
          phone: retailer.user.phone,
          email: retailer.user.email,
          isVerified: retailer.isVerified,
          isActive: retailer.user.isActive,
          createdAt: retailer.user.createdAt
        },
        walletBalance: retailer.walletBalance,
        creditSummary,
        orderStats,
        orders: retailer.orders,
        salesStats,
        sales: retailer.sales,
        nfcCards: retailer.nfcCards.map(card => ({
          id: card.id,
          uid: card.uid,
          status: card.status,
          balance: card.balance,
          cardType: card.cardType,
          createdAt: card.createdAt
        })),
        branches: retailer.branches,
        inventory: {
          totalProducts: retailer.inventory.length,
          lowStock: retailer.inventory.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length,
          outOfStock: retailer.inventory.filter(p => p.stock === 0).length
        },
        creditRequests: retailer.creditRequests,
        lastOrder,
        linkedWholesaler: retailer.linkedWholesaler ? {
          id: retailer.linkedWholesaler.id,
          companyName: retailer.linkedWholesaler.companyName,
          phone: retailer.linkedWholesaler.user?.phone,
          email: retailer.linkedWholesaler.user?.email
        } : null
      }
    });
  } catch (error: any) {
    console.error('Get Retailer Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get comprehensive real-time worker/employee account details (READ-ONLY)
export const getWorkerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employeeProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        attendances: {
          orderBy: { date: 'desc' },
          take: 30
        },
        leaveRequests: {
          orderBy: { createdAt: 'desc' }
        },
        billPayments: {
          orderBy: { createdAt: 'desc' }
        },
        enrollments: {
          include: {
            course: true,
            lessonProgress: true
          }
        },
        assignedTasks: {
          orderBy: { createdAt: 'desc' },
          include: {
            project: true
          }
        },
        projectMembers: {
          include: {
            project: true
          }
        }
      }
    });

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Attendance summary
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const monthlyAttendance = employee.attendances.filter(a => new Date(a.date) >= thisMonth);
    const attendanceSummary = {
      presentDays: monthlyAttendance.filter(a => a.status === 'present').length,
      absentDays: monthlyAttendance.filter(a => a.status === 'absent').length,
      lateDays: monthlyAttendance.filter(a => a.status === 'late').length,
      totalWorkHours: monthlyAttendance.reduce((sum, a) => sum + a.workHours, 0)
    };

    // Task statistics
    const taskStats = {
      todo: employee.assignedTasks.filter(t => t.status === 'TODO').length,
      inProgress: employee.assignedTasks.filter(t => t.status === 'IN_PROGRESS').length,
      completed: employee.assignedTasks.filter(t => t.status === 'COMPLETED').length,
      total: employee.assignedTasks.length
    };

    // Training progress
    const trainingProgress = employee.enrollments.map(e => ({
      courseId: e.courseId,
      courseTitle: e.course.title,
      progress: e.progress,
      status: e.status,
      completedLessons: e.lessonProgress.filter(lp => lp.completed).length,
      totalLessons: e.course.totalLessons
    }));

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: employee.id,
          userId: employee.userId,
          employeeNumber: employee.employeeNumber,
          name: employee.user.name,
          phone: employee.user.phone,
          email: employee.user.email,
          department: employee.department,
          position: employee.position,
          joiningDate: employee.joiningDate,
          status: employee.status,
          isActive: employee.user.isActive
        },
        salary: employee.salary,
        bankAccount: employee.bankAccount,
        attendanceSummary,
        recentAttendance: employee.attendances,
        leaveRequests: employee.leaveRequests,
        taskStats,
        tasks: employee.assignedTasks,
        projects: employee.projectMembers.map(pm => ({
          projectId: pm.project.id,
          projectName: pm.project.name,
          role: pm.role,
          status: pm.project.status,
          progress: pm.project.progress
        })),
        trainingProgress,
        billPayments: employee.billPayments
      }
    });
  } catch (error: any) {
    console.error('Get Worker Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get wholesaler account details with linked retailers (READ-ONLY)
export const getWholesalerAccountDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const wholesaler = await prisma.wholesalerProfile.findUnique({
      where: { id: Number(id) },
      include: {
        user: true,
        linkedRetailers: {
          include: {
            user: { select: { phone: true, email: true, isActive: true } },
            credit: true
          }
        },
        receivedOrders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            retailerProfile: { select: { shopName: true } },
            orderItems: { include: { product: true } }
          }
        },
        inventory: {
          take: 100
        },
        suppliers: {
          include: {
            supplierPayments: {
              orderBy: { paymentDate: 'desc' },
              take: 10
            }
          }
        },
        supplierPayments: {
          orderBy: { paymentDate: 'desc' },
          take: 50
        }
      }
    });

    if (!wholesaler) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Order statistics
    const orderStats = {
      pending: wholesaler.receivedOrders.filter(o => o.status === 'pending').length,
      active: wholesaler.receivedOrders.filter(o => o.status === 'processing').length,
      completed: wholesaler.receivedOrders.filter(o => o.status === 'completed').length,
      cancelled: wholesaler.receivedOrders.filter(o => o.status === 'cancelled').length,
      total: wholesaler.receivedOrders.length,
      totalRevenue: wholesaler.receivedOrders.reduce((sum, o) => sum + o.totalAmount, 0)
    };

    // Last order
    const lastOrder = wholesaler.receivedOrders.length > 0 ? wholesaler.receivedOrders[0] : null;

    res.json({
      success: true,
      accountDetails: {
        profile: {
          id: wholesaler.id,
          userId: wholesaler.userId,
          companyName: wholesaler.companyName,
          contactPerson: wholesaler.contactPerson,
          tinNumber: wholesaler.tinNumber,
          address: wholesaler.address,
          phone: wholesaler.user.phone,
          email: wholesaler.user.email,
          isVerified: wholesaler.isVerified,
          isActive: wholesaler.user.isActive,
          createdAt: wholesaler.user.createdAt
        },
        linkedRetailers: wholesaler.linkedRetailers.map(r => ({
          id: r.id,
          shopName: r.shopName,
          phone: r.user.phone,
          email: r.user.email,
          isActive: r.user.isActive,
          creditLimit: r.credit?.creditLimit || r.creditLimit,
          usedCredit: r.credit?.usedCredit || 0
        })),
        orderStats,
        orders: wholesaler.receivedOrders,
        inventory: {
          totalProducts: wholesaler.inventory.length,
          lowStock: wholesaler.inventory.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length,
          outOfStock: wholesaler.inventory.filter(p => p.stock === 0).length
        },
        suppliers: wholesaler.suppliers,
        supplierPayments: wholesaler.supplierPayments,
        lastOrder
      }
    });
  } catch (error: any) {
    console.error('Get Wholesaler Account Details Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// WHOLESALER-RETAILER LINKING (ACCOUNT LINKING ENFORCEMENT)
// ==========================================

// Get retailer-wholesaler linkage for admin panel
export const getRetailerWholesalerLinkage = async (req: AuthRequest, res: Response) => {
  try {
    const retailers = await prisma.retailerProfile.findMany({
      include: {
        user: { select: { phone: true, email: true, isActive: true } },
        linkedWholesaler: {
          select: { id: true, companyName: true, user: { select: { phone: true } } }
        }
      }
    });

    const wholesalers = await prisma.wholesalerProfile.findMany({
      include: {
        user: { select: { phone: true, email: true, isActive: true } },
        linkedRetailers: {
          select: { id: true, shopName: true }
        }
      }
    });

    res.json({
      success: true,
      linkage: {
        retailers: retailers.map(r => ({
          id: r.id,
          shopName: r.shopName,
          phone: r.user.phone,
          isActive: r.user.isActive,
          linkedWholesalerId: r.linkedWholesalerId,
          linkedWholesalerName: r.linkedWholesaler?.companyName || null
        })),
        wholesalers: wholesalers.map(w => ({
          id: w.id,
          companyName: w.companyName,
          phone: w.user.phone,
          isActive: w.user.isActive,
          linkedRetailersCount: w.linkedRetailers.length,
          linkedRetailers: w.linkedRetailers
        }))
      }
    });
  } catch (error: any) {
    console.error('Get Retailer-Wholesaler Linkage Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Link retailer to wholesaler (Admin function)
export const linkRetailerToWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { retailerId, wholesalerId } = req.body;

    if (!retailerId || !wholesalerId) {
      return res.status(400).json({ success: false, error: 'Both retailerId and wholesalerId are required' });
    }

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(wholesalerId) } });
    if (!wholesaler) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Check if retailer is already linked to a different wholesaler
    if (retailer.linkedWholesalerId && retailer.linkedWholesalerId !== Number(wholesalerId)) {
      return res.status(400).json({
        success: false,
        error: 'Retailer is already linked to another wholesaler. Unlink first before linking to a new one.'
      });
    }

    await prisma.retailerProfile.update({
      where: { id: Number(retailerId) },
      data: { linkedWholesalerId: Number(wholesalerId) }
    });

    res.json({ success: true, message: 'Retailer successfully linked to wholesaler' });
  } catch (error: any) {
    console.error('Link Retailer to Wholesaler Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Unlink retailer from wholesaler (Admin function)
export const unlinkRetailerFromWholesaler = async (req: AuthRequest, res: Response) => {
  try {
    const { retailerId } = req.body;

    if (!retailerId) {
      return res.status(400).json({ success: false, error: 'retailerId is required' });
    }

    const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(retailerId) } });
    if (!retailer) {
      return res.status(404).json({ success: false, error: 'Retailer not found' });
    }

    await prisma.retailerProfile.update({
      where: { id: Number(retailerId) },
      data: { linkedWholesalerId: null }
    });

    res.json({ success: true, message: 'Retailer successfully unlinked from wholesaler' });
  } catch (error: any) {
    console.error('Unlink Retailer from Wholesaler Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// SETTLEMENT INVOICE MANAGEMENT
// ==========================================

// Get all settlement invoices with filters
export const getSettlementInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { month, partyType, partyId } = req.query;

    const where: any = {};
    if (month) where.settlementMonth = month as string;
    if (partyType) where.partyType = partyType as string;
    if (partyId) {
      if (partyType === 'retailer') {
        where.retailerId = Number(partyId);
      } else if (partyType === 'wholesaler') {
        where.wholesalerId = Number(partyId);
      }
    }

    const invoices = await prisma.settlementInvoice.findMany({
      where,
      include: {
        retailerProfile: { select: { id: true, shopName: true } },
        wholesalerProfile: { select: { id: true, companyName: true } }
      },
      orderBy: [{ settlementMonth: 'desc' }, { createdAt: 'desc' }]
    });

    const formattedInvoices = invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      partyType: inv.partyType,
      partyId: inv.partyType === 'retailer' ? inv.retailerId : inv.wholesalerId,
      partyName: inv.partyType === 'retailer'
        ? inv.retailerProfile?.shopName
        : inv.wholesalerProfile?.companyName,
      settlementMonth: inv.settlementMonth,
      totalAmount: inv.totalAmount,
      invoiceFileUrl: inv.invoiceFileUrl,
      notes: inv.notes,
      uploadedBy: inv.uploadedBy,
      uploadedAt: inv.createdAt
    }));

    res.json({ success: true, invoices: formattedInvoices });
  } catch (error: any) {
    console.error('Get Settlement Invoices Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create/upload a settlement invoice
export const createSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { partyType, partyId, settlementMonth, totalAmount, invoiceFileUrl, notes } = req.body;
    const uploadedBy = req.user?.id;

    if (!partyType || !partyId || !settlementMonth || totalAmount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'partyType, partyId, settlementMonth, and totalAmount are required'
      });
    }

    if (partyType !== 'retailer' && partyType !== 'wholesaler') {
      return res.status(400).json({ success: false, error: 'partyType must be "retailer" or "wholesaler"' });
    }

    // Validate party exists
    if (partyType === 'retailer') {
      const retailer = await prisma.retailerProfile.findUnique({ where: { id: Number(partyId) } });
      if (!retailer) return res.status(404).json({ success: false, error: 'Retailer not found' });
    } else {
      const wholesaler = await prisma.wholesalerProfile.findUnique({ where: { id: Number(partyId) } });
      if (!wholesaler) return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Generate invoice number
    const count = await prisma.settlementInvoice.count();
    const invoiceNumber = `INV-${settlementMonth}-${(count + 1).toString().padStart(4, '0')}`;

    const invoice = await prisma.settlementInvoice.create({
      data: {
        invoiceNumber,
        partyType,
        retailerId: partyType === 'retailer' ? Number(partyId) : null,
        wholesalerId: partyType === 'wholesaler' ? Number(partyId) : null,
        settlementMonth,
        totalAmount: Number(totalAmount),
        invoiceFileUrl,
        notes,
        uploadedBy: uploadedBy || 0
      },
      include: {
        retailerProfile: { select: { shopName: true } },
        wholesalerProfile: { select: { companyName: true } }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Settlement invoice created successfully',
      invoice: {
        ...invoice,
        partyName: partyType === 'retailer'
          ? invoice.retailerProfile?.shopName
          : invoice.wholesalerProfile?.companyName
      }
    });
  } catch (error: any) {
    console.error('Create Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single settlement invoice
export const getSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const invoice = await prisma.settlementInvoice.findUnique({
      where: { id: Number(id) },
      include: {
        retailerProfile: { select: { id: true, shopName: true, user: { select: { phone: true, email: true } } } },
        wholesalerProfile: { select: { id: true, companyName: true, user: { select: { phone: true, email: true } } } }
      }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    res.json({ success: true, invoice });
  } catch (error: any) {
    console.error('Get Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update settlement invoice
export const updateSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { totalAmount, invoiceFileUrl, notes } = req.body;

    const invoice = await prisma.settlementInvoice.update({
      where: { id: Number(id) },
      data: {
        totalAmount: totalAmount !== undefined ? Number(totalAmount) : undefined,
        invoiceFileUrl,
        notes
      }
    });

    res.json({ success: true, message: 'Invoice updated successfully', invoice });
  } catch (error: any) {
    console.error('Update Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete settlement invoice
export const deleteSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.settlementInvoice.delete({ where: { id: Number(id) } });

    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error: any) {
    console.error('Delete Settlement Invoice Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
