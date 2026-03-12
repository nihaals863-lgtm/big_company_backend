import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import { uploadImage } from '../utils/cloudinary';

// Get dashboard stats
// Get dashboard stats with comprehensive calculations
export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id },
      include: {
        orders: true // Orders to wholesalers
      }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    // Date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)); // Monday
    startOfWeek.setHours(0, 0, 0, 0);

    // Fetch data in parallel
    const [
      todaySales,
      allSales,
      inventory,
      pendingOrders
    ] = await Promise.all([
      // Today's Sales
      prisma.sale.findMany({
        where: {
          retailerId: retailerProfile.id,
          createdAt: { gte: today, lt: tomorrow }
        },
        include: { saleItems: true }
      }),
      // All Sales (for revenue stats)
      prisma.sale.findMany({
        where: { retailerId: retailerProfile.id }
      }),
      // Inventory
      prisma.product.findMany({
        where: {
          OR: [
            { retailerId: retailerProfile.id },
            { retailerId: null }
          ]
        }
      }),
      // Pending Orders (to wholesalers)
      prisma.order.findMany({
        where: {
          retailerId: retailerProfile.id,
          status: 'pending'
        }
      })
    ]);

    // Calculate Stats
    // DYNAMIC PROFIT CALCULATION (Realized form Sales)
    const sales = await prisma.sale.findMany({
      where: { retailerId: retailerProfile.id },
      include: {
        saleItems: {
          include: { product: true }
        }
      }
    });

    let totalRevenue = 0;
    let totalCost = 0;

    for (const sale of sales) {
      // Calculate from sale items to be accurate with cost at time of sale? 
      // Current schema stores cost in saleItem? No, strictly schema has price. 
      // We rely on current product cost or if we stored it. 
      // Ideally SaleItem should convert costPrice. 
      // For now, using product.costPrice.
      for (const item of sale.saleItems) {
        const revenue = item.price * item.quantity;
        const cost = (item.product.costPrice || 0) * item.quantity;
        totalRevenue += revenue;
        totalCost += cost;
      }
    }

    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    const todaySalesAmount = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const customersToday = new Set(todaySales.map(s => s.consumerId).filter(Boolean)).size || todaySales.length;
    const totalOrders = todaySales.length;

    // Inventory Stats
    const inventoryItems = inventory.length;
    // LOW STOCK: Dynamically calculated (stock <= lowStockThreshold OR stock === 0)
    const lowStockItems = inventory.filter(p => {
      const threshold = p.lowStockThreshold || 10;
      return p.stock <= threshold;
    }).map(p => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      threshold: p.lowStockThreshold || 10,
      status: p.stock === 0 ? 'out_of_stock' : 'low_stock',
      cost_price: p.costPrice,
      selling_price: p.price
    }));

    const lowStockCount = lowStockItems.length;

    const capitalWallet = inventory.reduce((sum, p) => sum + (p.stock * (p.costPrice || 0)), 0);
    const potentialRevenue = inventory.reduce((sum, p) => sum + (p.stock * p.price), 0);
    const profitWallet = potentialRevenue - capitalWallet; // This is Potential Inventory Profit

    // Payment Method Breakdown
    const paymentStats = todaySales.reduce((acc, sale) => {
      const method = sale.paymentMethod || 'cash';
      acc[method] = (acc[method] || 0) + sale.totalAmount;
      return acc;
    }, {} as Record<string, number>);

    const paymentMethodsData = Object.entries(paymentStats).map(([name, value]) => ({
      name: name === 'momo' ? 'Mobile Money' : name.charAt(0).toUpperCase() + name.slice(1),
      value: Math.round((value / (todaySalesAmount || 1)) * 100), // Percentage
      color: name === 'momo' ? '#ffcc00' : name === 'cash' ? '#52c41a' : '#1890ff'
    }));

    // Hourly Sales Data (for chart)
    const salesByHour = new Array(24).fill(0).map((_, i) => ({
      name: `${i}:00`,
      sales: 0,
      customers: 0
    }));

    todaySales.forEach(sale => {
      const hour = new Date(sale.createdAt).getHours();
      if (salesByHour[hour]) {
        salesByHour[hour].sales += sale.totalAmount;
        salesByHour[hour].customers += 1;
      }
    });

    const currentHour = new Date().getHours();
    const chartData = salesByHour.slice(Math.max(0, currentHour - 12), currentHour + 1); // Last 12 hours

    // Top Products
    const topSellingItems = await prisma.saleItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, price: true },
      where: {
        sale: { retailerId: retailerProfile.id }
      },
      orderBy: {
        _sum: { quantity: 'desc' }
      },
      take: 5
    });

    const topProductIds = topSellingItems.map(item => item.productId);
    const topProductsDetails = await prisma.product.findMany({
      where: { id: { in: topProductIds } }
    });

    const topProducts = topSellingItems.map(item => {
      const product = topProductsDetails.find(p => p.id === item.productId);
      return {
        id: item.productId,
        name: product?.name || 'Unknown Product',
        sold: item._sum.quantity || 0,
        revenue: (item._sum.price || 0),
        stock: product?.stock || 0,
        trend: 0 // Placeholder
      };
    });

    // Recent Orders
    const recentOrders = await prisma.sale.findMany({
      where: { retailerId: retailerProfile.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { consumerProfile: true }
    });

    const formattedRecentOrders = recentOrders.map(order => ({
      id: order.id.toString(),
      customer: order.consumerProfile?.fullName || 'Walk-in Customer',
      items: 0,
      total: order.totalAmount,
      status: order.status,
      date: order.createdAt,
      payment: order.paymentMethod
    }));

    res.json({
      success: true,
      stats: {
        // Base Stats
        totalOrders,
        pendingOrders: pendingOrders.length,
        totalRevenue, // Now Realized Revenue
        totalCost,
        totalProfit, // NEW: Realized Profit
        profitMargin: profitMargin.toFixed(2), // NEW: Margin

        // Inventory
        inventoryItems,
        lowStockItems: lowStockItems, // Array
        lowStockCount, // Number

        // Wallets
        capitalWallet,
        profitWallet, // Keep for backward compatibility (Unknown if fontend relies on it)
        walletBalance: retailerProfile.walletBalance,
        creditLimit: retailerProfile.creditLimit,

        // Today
        todaySales: todaySalesAmount,
        customersToday,
        growth: { orders: 0, revenue: 0 },

        // Payment breakdown
        dashboardWalletRevenue: paymentStats['wallet'] || 0,
        creditWalletRevenue: paymentStats['credit'] || 0,
        mobileMoneyRevenue: paymentStats['momo'] || 0,
        cashRevenue: paymentStats['cash'] || 0,
        gasRewardsGiven: 0,
        gasRewardsValue: 0
      },

      // Lists
      salesData: chartData,
      paymentMethods: paymentMethodsData,
      topProducts: topProducts,
      recentOrders: formattedRecentOrders,
      lowStockList: lowStockItems // Consistent naming
    });

  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: error.message });
  }
};


// Get inventory (Retailer's products + Wholesaler Catalog)
export const getInventory = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    // 1. Get Retailer's own inventory (and global items)
    const myProducts = await prisma.product.findMany({
      where: {
        OR: [
          { retailerId: retailerProfile.id },
          { retailerId: null }
        ]
      },
      orderBy: { name: 'asc' }
    });

    // 2. Get Global Catalog (Wholesaler products)
    const catalogProducts = await prisma.product.findMany({
      where: { wholesalerId: { not: null } },
      include: { wholesalerProfile: true },
      orderBy: { name: 'asc' }
    });

    // 3. Merge: If retailer has the product, use theirs. If not, show catalog item (stock 0)
    // We match by SKU if available, otherwise Name
    const myProductMap = new Map();
    myProducts.forEach(p => {
      const key = p.sku || p.name;
      myProductMap.set(key, p);
    });

    const mergedInventory = [...myProducts];

    catalogProducts.forEach(cp => {
      const key = cp.sku || cp.name;
      if (!myProductMap.has(key)) {
        // Retailer doesn't have this one yet. Add as potential item.
        mergedInventory.push({
          ...cp,
          id: cp.id, // Use catalog ID
          retailerId: retailerProfile.id, // Mock it for frontend compatibility or handle as different
          stock: 0,
          price: cp.price * 1.2, // Estimated selling price (20% markup)
          costPrice: cp.price,
          status: 'catalog_item' // distinct status
        });
      }
    });

    // Sort combined list
    mergedInventory.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ products: mergedInventory });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create product (Manual or Invoice-based)
export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { invoice_number, name, description, sku, category, price, costPrice, stock, image } = req.body;

    // --- Invoice Flow ---
    if (invoice_number) {
      // Find the order by ID (treating invoice_number as Order ID)
      let order = await prisma.order.findUnique({
        where: { id: Number(invoice_number) },
        include: {
          orderItems: {
            include: { product: true }
          }
        }
      });

      // Validates if the invoice number corresponds to a ProfitInvoice
      if (!order) {
        const profitInvoice = await prisma.profitInvoice.findUnique({
          where: { invoiceNumber: invoice_number },
          include: { order: { include: { orderItems: { include: { product: true } } } } }
        });
        if (profitInvoice) {
          order = profitInvoice.order;
        }
      }

      if (!order) {

        return res.status(404).json({ error: `Invoice/Order not found. Received ID: ${invoice_number}` });
      }

      // Security check: ensure order belongs to this retailer
      if (order.retailerId !== retailerProfile.id) {
        return res.status(403).json({ error: 'Unauthorized: Invoice does not belong to you' });
      }

      // Check if already processed (optional, but good practice to avoid duplicates)
      // For now, we allow re-importing which might duplicate or fail on uniqueness. 
      // Let's check if products with this invoiceNumber already exist.
      const existing = invoice_number ? await prisma.product.findFirst({
        where: { retailerId: retailerProfile.id, invoiceNumber: invoice_number }
      }) : null;
      if (existing) {
        return res.status(400).json({ error: 'Invoice already imported' });
      }

      const createdProducts = [];
      for (const item of order.orderItems) {
        const sourceProduct = item.product;
        // Create new inventory item
        const newProduct = await prisma.product.create({
          data: {
            name: sourceProduct.name,
            description: sourceProduct.description,
            sku: sourceProduct.sku, // Keep SKU or generate new? Keeping same simplifies tracking.
            category: sourceProduct.category,
            price: sourceProduct.price * 1.2, // Default markup 20%
            costPrice: item.price, // Cost is what they paid in the order
            stock: item.quantity,
            unit: sourceProduct.unit,
            invoiceNumber: invoice_number,
            retailerId: retailerProfile.id,
            image: sourceProduct.image,
            status: 'active'
          }
        });
        createdProducts.push(newProduct);
      }
      return res.json({ success: true, count: createdProducts.length, message: `Imported ${createdProducts.length} items from invoice` });
    }

    // --- Manual Flow (Single Product) ---
    // Validate required fields for manual creation
    if (!name || !price) {
      return res.status(400).json({ error: 'Name and Price are required for manual creation' });
    }

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
        category: category || 'General',
        price: parseFloat(price),
        costPrice: costPrice ? parseFloat(costPrice) : undefined,
        stock: stock ? parseInt(stock) : 0,
        image: imageUrl,
        retailerId: retailerProfile.id
      }
    });

    res.json({ success: true, product });
  } catch (error: any) {
    console.error('Create product error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update product
export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, category, price, costPrice, stock, image } = req.body;

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
        category,
        price: price ? parseFloat(price) : undefined,
        costPrice: costPrice ? parseFloat(costPrice) : undefined,
        stock: stock !== undefined ? parseInt(stock) : undefined,
        image: imageUrl
      }
    });

    res.json({ success: true, product });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get orders
// Get orders (Customer Sales)
export const getOrders = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { status, payment_status, search, limit = '20', offset = '0' } = req.query;

    const where: any = {
      retailerId: retailerProfile.id
    };

    if (status) where.status = status;
    if (payment_status) where.paymentMethod = payment_status; // Mapping payment_status filter to paymentMethod

    // Search by ID or Customer Name
    if (search) {
      const searchNum = Number(search);
      where.OR = [
        { consumer: { fullName: { contains: search as string } } }
      ];
      if (!isNaN(searchNum)) {
        where.OR.push({ id: searchNum });
      }
    }

    const sales = await prisma.sale.findMany({
      where,
      include: { consumerProfile: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    const total = await prisma.sale.count({ where });

    // Map to frontend Order interface
    const formattedOrders = sales.map(sale => ({
      id: sale.id,
      display_id: sale.id.toString(),
      customer_name: sale.consumerProfile?.fullName || 'Walk-in Customer',
      customer_phone: sale.consumerProfile?.user?.phone || 'N/A',
      customer_email: sale.consumerProfile?.user?.email,
      items: [], // saleItems not included in query, would need separate fetch
      subtotal: sale.totalAmount, // Simplified
      discount: 0,
      total: sale.totalAmount,
      status: sale.status, // pending, processing, ready, completed, cancelled
      payment_method: sale.paymentMethod,
      payment_status: 'paid', // Assumed paid for now unless credit
      notes: '',
      created_at: sale.createdAt.toISOString(),
      updated_at: sale.updatedAt.toISOString(),
      completed_at: sale.status === 'completed' ? sale.updatedAt.toISOString() : undefined
    }));


    res.json({ orders: formattedOrders, total });
  } catch (error: any) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get single order
export const getOrder = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { id } = req.params;

    const sale = await prisma.sale.findFirst({
      where: {
        id: Number(id),
        retailerId: retailerProfile.id
      },
      include: {
        consumerProfile: { include: { user: true } },
        saleItems: { include: { product: true } }
      }
    });

    if (!sale) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const formattedOrder = {
      id: sale.id,
      display_id: sale.id.toString(),
      customer_name: sale.consumerProfile?.fullName || 'Walk-in Customer',
      customer_phone: sale.consumerProfile?.user?.phone || 'N/A',
      customer_email: sale.consumerProfile?.user?.email,
      items: sale.saleItems.map(item => ({
        id: item.id,
        product_id: item.productId,
        product_name: item.product.name,
        sku: item.product.sku,
        image: item.product.image,
        quantity: item.quantity,
        unit_price: item.price,
        total: item.price * item.quantity
      })),
      subtotal: sale.totalAmount, // Simplified
      discount: 0,
      total: sale.totalAmount,
      status: sale.status,
      payment_method: sale.paymentMethod,
      payment_status: 'paid',
      notes: '',
      created_at: sale.createdAt.toISOString(),
      updated_at: sale.updatedAt.toISOString(),
      completed_at: sale.status === 'completed' ? sale.updatedAt.toISOString() : undefined
    };

    res.json({ order: formattedOrder });
  } catch (error: any) {
    console.error('Get order error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get branches
export const getBranches = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const branches = await prisma.branch.findMany({
      where: { retailerId: retailerProfile.id },
      include: { terminals: true }
    });

    res.json({ branches });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create branch
export const createBranch = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { name, location } = req.body;

    const branch = await prisma.branch.create({
      data: {
        name,
        location,
        retailerId: retailerProfile.id
      }
    });

    res.json({ success: true, branch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get wallet
export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    res.json({
      balance: retailerProfile.walletBalance,
      creditLimit: retailerProfile.creditLimit,
      availableCredit: retailerProfile.creditLimit - 0 // Assuming no outstanding credit for now
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// POS FUNCTIONS
// ==========================================

// Get POS Products (with search and stock info)
export const getPOSProducts = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { search, limit = '50', offset = '0' } = req.query;

    const where: any = {
      retailerId: retailerProfile.id, // Only show products belonging to this retailer
      status: 'active',
      stock: { gt: 0 } // Only show products with stock available
    };

    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search as string } },
            { sku: { contains: search as string } },
            { barcode: { contains: search as string } }
          ]
        }
      ];
    }

    const products = await prisma.product.findMany({
      where,
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      orderBy: { name: 'asc' }
    });

    res.json({ products });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Scan Barcode
export const scanBarcode = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { barcode } = req.body;

    if (!barcode) {
      return res.status(400).json({ error: 'Barcode is required' });
    }

    const product = await prisma.product.findFirst({
      where: {
        retailerId: retailerProfile.id,
        barcode: barcode as string,
        status: 'active'
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create Sale (Retailer POS)
export const createSale = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const {
      items,
      payment_method, // 'cash', 'nfc', 'wallet', 'momo'
      subtotal,
      tax_amount,
      discount,
      customer_phone,
      payment_details // { pin, uid } for NFC
    } = req.body;

    const total = (subtotal + tax_amount - (discount || 0));

    // 1. Validate items and stock
    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: Number(item.product_id) } });
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for product: ${product?.name || item.product_id}`
        });
      }
    }

    // 2. Perform Transaction
    const result = await prisma.$transaction(async (prisma) => {
      let consumerId = null;

      // --- Handle NFC Payment ---
      if (payment_method === 'nfc') {
        const { uid, pin } = payment_details || {};
        const card = await prisma.nfcCard.findUnique({ where: { uid } });

        if (!card) throw new Error('NFC Card not found');
        if (card.status !== 'active') throw new Error('NFC Card is not active');
        if (pin && card.pin !== pin) throw new Error('Invalid NFC PIN');
        if (card.balance < total) throw new Error('Insufficient NFC card balance');

        // Deduct from card
        await prisma.nfcCard.update({
          where: { id: card.id },
          data: { balance: { decrement: total } }
        });

        consumerId = card.consumerId;
      }

      // --- Handle Wallet Payment ---
      if (payment_method === 'wallet') {
        if (!customer_phone) throw new Error('Customer phone required for wallet payment');
        const consumer = await prisma.consumerProfile.findFirst({
          where: { user: { phone: customer_phone as string } }
        });

        if (!consumer) throw new Error('Consumer profile not found for this phone number');
        if (consumer.walletBalance < total) throw new Error('Insufficient dashboard wallet balance');

        // Deduct from wallet
        await prisma.consumerProfile.update({
          where: { id: consumer.id },
          data: { walletBalance: { decrement: total } }
        });

        consumerId = consumer.id;
      }

      // --- Handle PalmKash (Mobile Money) ---
      let externalRef = null;
      if (payment_method === 'mobile_money' || payment_method === 'momo') {
        if (!customer_phone) throw new Error('Customer phone required for mobile money payment');
        
        const palmKash = (await import('../services/palmKash.service')).default;
        const pmResult = await palmKash.initiatePayment({
          amount: total,
          phoneNumber: customer_phone as string,
          referenceId: `POS-${Date.now()}`,
          description: `POS Sale at ${retailerProfile.shopName}`
        });

        if (!pmResult.success) {
          throw new Error(pmResult.error || 'PalmKash payment initiation failed');
        }
        externalRef = pmResult.transactionId;

        // Try to identify consumer for rewards
        const consumer = await prisma.consumerProfile.findFirst({
          where: { user: { phone: customer_phone as string } }
        });
        if (consumer) consumerId = consumer.id;
      }

      // Create Sale Record
      const sale = await prisma.sale.create({
        data: {
          retailerId: retailerProfile.id,
          consumerId: consumerId,
          totalAmount: total,
          paymentMethod: payment_method,
          status: 'completed', // In Sandbox we assume success for now to keep flow identical
          meterId: externalRef, // Store PalmKash TransID in meterId as a common reference field
          saleItems: {
            create: items.map((item: any) => ({
              productId: Number(item.product_id),
              quantity: item.quantity,
              price: item.price
            }))
          }
        }
      });

      // Update Stock
      for (const item of items) {
        await prisma.product.update({
          where: { id: Number(item.product_id) },
          data: { stock: { decrement: item.quantity } }
        });
      }

      // Log Transaction if linked to consumer
      if (consumerId && (['wallet', 'dashboard_wallet', 'credit_wallet', 'nfc'].includes(payment_method))) {
        const walletType = payment_method === 'credit_wallet' ? 'credit_wallet' : 'dashboard_wallet';
        const wallet = await prisma.wallet.findFirst({
          where: { consumerId: consumerId, type: walletType }
        });
        if (wallet) {
          await prisma.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'purchase',
              amount: -total,
              description: `POS purchase at ${retailerProfile.shopName}`,
              status: 'completed',
              reference: sale.id.toString()
            }
          });
        }
      }

      // ==========================================
      // GAS REWARD LOGIC (POS)
      // ==========================================
      const { gasRewardWalletId, gas_meter_id } = req.body; // Accept both for backward compatibility
      const targetRewardId = gasRewardWalletId || gas_meter_id;

      const isRewardEligible = ['dashboard_wallet', 'mobile_money', 'wallet'].includes(payment_method);

      // Validation: ID is mandatory for dashboard_wallet, optional for mobile_money
      if (payment_method === 'dashboard_wallet' && !targetRewardId) {
        throw new Error('Gas Reward Wallet ID is required for Dashboard Wallet payments to earn rewards.');
      }

      if (isRewardEligible && targetRewardId && consumerId) {
        // Calculate Profit
        let totalProfit = 0;

        for (const item of items) {
          const product = await prisma.product.findUnique({ where: { id: Number(item.product_id) } });
          if (product && product.costPrice) {
            const profitPerItem = item.price - product.costPrice;
            if (profitPerItem > 0) {
              totalProfit += profitPerItem * item.quantity;
            }
          }
        }

        if (totalProfit > 0) {
          const rewardAmountRWF = totalProfit * 0.12; // 12% of profit
          const rewardUnits = rewardAmountRWF / 300; 

          await prisma.gasReward.create({
            data: {
              consumerId: consumerId,
              saleId: sale.id,
              meterId: targetRewardId,
              units: rewardUnits,
              profitAmount: totalProfit,
              source: 'pos_reward',
              reference: `Reward for POS Sale #${sale.id}`
            }
          });

          // Update sale with meterId (Reward Wallet ID) if schema supports it
          await prisma.sale.update({
            where: { id: sale.id },
            data: { meterId: targetRewardId }
          });
        }
      }

      return sale;
    });

    res.json({ success: true, sale: result });

  } catch (error: any) {
    console.error('Sale failed:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update Sale Status (Retailer side for dashboard orders)
export const updateSaleStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    let { status, notes } = req.body;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const currentSale = await prisma.sale.findUnique({ where: { id: Number(id) } });
    if (!currentSale || currentSale.retailerId !== retailerProfile.id) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Map frontend status names to backend: processing = confirmed
    if (status === 'processing') status = 'confirmed';

    // State machine: pending -> confirmed/processing -> ready -> completed / cancelled
    const validTransitions: Record<string, string[]> = {
      'pending': ['confirmed', 'processing', 'cancelled'],
      'confirmed': ['ready', 'cancelled'],
      'processing': ['ready', 'cancelled'],
      'ready': ['completed', 'delivered'],
      'completed': [],
      'delivered': [],
      'cancelled': []
    };

    if (!validTransitions[currentSale.status]?.includes(status)) {
      return res.status(400).json({
        error: `Invalid status transition from ${currentSale.status} to ${status}`
      });
    }

    const sale = await prisma.sale.update({
      where: { id: Number(id) },
      data: { status }
    });

    res.json({ success: true, sale });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Cancel a sale/order
export const cancelSale = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const currentSale = await prisma.sale.findUnique({ where: { id: Number(id) } });
    if (!currentSale || currentSale.retailerId !== retailerProfile.id) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Can only cancel pending or confirmed orders
    if (!['pending', 'confirmed', 'processing'].includes(currentSale.status)) {
      return res.status(400).json({
        error: `Cannot cancel order in ${currentSale.status} status`
      });
    }

    const sale = await prisma.sale.update({
      where: { id: Number(id) },
      data: {
        status: 'cancelled'
        // Could add cancelReason field if exists in schema
      }
    });

    res.json({ success: true, sale, message: 'Order cancelled successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Fulfill/Complete an order
export const fulfillSale = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const currentSale = await prisma.sale.findUnique({ where: { id: Number(id) } });
    if (!currentSale || currentSale.retailerId !== retailerProfile.id) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Can only fulfill ready orders
    if (!['ready', 'confirmed', 'processing'].includes(currentSale.status)) {
      return res.status(400).json({
        error: `Cannot fulfill order in ${currentSale.status} status`
      });
    }

    const sale = await prisma.sale.update({
      where: { id: Number(id) },
      data: { status: 'completed' }
    });

    res.json({ success: true, sale, message: 'Order completed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get Daily Sales Stats
export const getDailySales = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaySales = await prisma.sale.findMany({
      where: {
        retailerId: retailerProfile.id,
        createdAt: { gte: today, lt: tomorrow }
      }
    });

    const totalSales = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const transactionCount = todaySales.length;

    // Aggregation by payment method
    const paymentMethods = todaySales.reduce((acc, s) => {
      const method = s.paymentMethod;
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      total_sales: totalSales,
      transaction_count: transactionCount,
      mobile_payment_transactions: paymentMethods['mobile_money'] || 0,
      dashboard_wallet_transactions: paymentMethods['dashboard_wallet'] || 0,
      credit_wallet_transactions: paymentMethods['credit_wallet'] || 0,
      gas_rewards_m3: 0,
      gas_rewards_rwf: 0
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// WHOLESALE ORDERING FUNCTIONS
// ==========================================

// Get Wholesaler Products
// NEW LOGIC:
// - Retailer can view products of ANY wholesaler (READ-ONLY for discovery)
// - Retailer can ONLY BUY from linked wholesaler
// - If wholesalerId param provided, show that wholesaler's products
// - If no wholesalerId, show linked wholesaler's products (if linked)
export const getWholesalerProducts = async (req: AuthRequest, res: Response) => {
  try {
    const { search, category, limit = '50', offset = '0', wholesalerId } = req.query;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const isLinked = !!retailerProfile.linkedWholesalerId;
    let canBuy = false;
    let viewingWholesalerId: number | null = null;

    const where: any = { status: 'active' };

    // Case 1: Viewing specific wholesaler's products (for discovery)
    if (wholesalerId) {
      viewingWholesalerId = parseInt(wholesalerId as string);
      where.wholesalerId = viewingWholesalerId;

      // Can only buy if this is the linked wholesaler
      canBuy = isLinked && retailerProfile.linkedWholesalerId === viewingWholesalerId;
    }
    // Case 2: No wholesalerId specified
    else if (isLinked) {
      // Show linked wholesaler's products
      viewingWholesalerId = retailerProfile.linkedWholesalerId;
      where.wholesalerId = retailerProfile.linkedWholesalerId;
      canBuy = true;
    } else {
      // Not linked and no wholesalerId specified - return empty with guidance
      return res.json({
        success: true,
        products: [],
        isLinked: false,
        canBuy: false,
        linkedWholesalerId: null,
        message: 'Please select a wholesaler to view their products, or link with a wholesaler to start ordering.'
      });
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { sku: { contains: search as string } }
      ];
    }

    if (category) {
      where.category = category as string;
    }

    const products = await prisma.product.findMany({
      where,
      include: { wholesalerProfile: true },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      orderBy: { name: 'asc' }
    });

    // Get wholesaler info
    let wholesalerInfo = null;
    if (viewingWholesalerId) {
      const wholesaler = await prisma.wholesalerProfile.findUnique({
        where: { id: viewingWholesalerId },
        select: { id: true, companyName: true, address: true }
      });
      wholesalerInfo = wholesaler;
    }

    // Map to frontend expected format
    const formattedProducts = products.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      wholesaler_price: p.price,
      stock_available: p.stock,
      min_order: 1,
      unit: p.unit || 'unit',
      wholesaler_name: p.wholesalerProfile?.companyName
    }));

    res.json({
      success: true,
      products: formattedProducts,
      isLinked,
      canBuy,
      linkedWholesalerId: retailerProfile.linkedWholesalerId,
      viewingWholesalerId,
      wholesalerInfo
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create Wholesaler Order
// ACCOUNT LINKING ENFORCEMENT: Retailer can ONLY order from ONE Wholesaler after approval
export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id },
      include: { user: true }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    // ==========================================
    // ACCOUNT LINKING ENFORCEMENT (MANDATORY)
    // Retailer MUST be linked to a wholesaler before placing orders
    // ==========================================
    if (!retailerProfile.linkedWholesalerId) {
      return res.status(403).json({
        success: false,
        error: 'You must be linked to a wholesaler before placing orders. Please send a link request and wait for approval.',
        requiresLinking: true
      });
    }

    const { items, totalAmount, paymentMethod = 'wallet' } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain items' });
    }

    // Determine wholesaler from the first product
    const firstProductId = items[0].product_id;
    const firstProduct = await prisma.product.findUnique({ where: { id: firstProductId } });

    if (!firstProduct || !firstProduct.wholesalerId) {
      return res.status(400).json({ error: 'Product does not belong to a wholesaler' });
    }
    const wholesalerId = firstProduct.wholesalerId;

    // Verify retailer is ordering from their linked wholesaler ONLY
    if (retailerProfile.linkedWholesalerId !== wholesalerId) {
      return res.status(403).json({
        success: false,
        error: 'You can only order from your linked wholesaler. These products belong to a different wholesaler.',
        linkedWholesalerId: retailerProfile.linkedWholesalerId,
        attemptedWholesalerId: wholesalerId
      });
    }

    // Verify ALL items belong to the SAME (linked) wholesaler
    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.product_id } });
      if (!product || product.wholesalerId !== wholesalerId) {
        return res.status(400).json({
          success: false,
          error: 'All items must belong to your linked wholesaler.'
        });
      }
    }

    // Transaction: Create Order, Debit Wallet/Credit, and Link Retailer
    const result = await prisma.$transaction(async (prisma) => {
      // 1. Payment Processing Logic
      if (paymentMethod === 'wallet') {
        if (retailerProfile.walletBalance < totalAmount) {
          throw new Error('Insufficient wallet balance');
        }
        // Debit Wallet
        await prisma.retailerProfile.update({
          where: { id: retailerProfile.id },
          data: { walletBalance: { decrement: totalAmount } }
        });
      } else if (paymentMethod === 'credit') {
        const credit = await prisma.retailerCredit.findUnique({
          where: { retailerId: retailerProfile.id }
        });
        if (!credit || credit.availableCredit < totalAmount) {
          throw new Error('Insufficient credit limit available');
        }
        // Update Credit Usage
        await prisma.retailerCredit.update({
          where: { id: credit.id },
          data: {
            availableCredit: { decrement: totalAmount },
            usedCredit: { increment: totalAmount }
          }
        });
      } else if (paymentMethod === 'momo') {
        // ==========================================
        // PALMKASH INTEGRATION
        // ==========================================
        const palmKash = (await import('../services/palmKash.service')).default;
        const pmResult = await palmKash.initiatePayment({
          amount: totalAmount,
          phoneNumber: (retailerProfile as any).user?.phone || req.body.phone || '',
          referenceId: `WHL-${Date.now()}`,
          description: `Wholesale Order Payment`
        });

        if (!pmResult.success) {
          throw new Error(pmResult.error || 'PalmKash payment initiation failed');
        }
        // Store reference in external location? Order doesn't have ref field.
        // We can use a comment or just log it. In this app, many things use ID.
      } else {
        throw new Error('Invalid payment method');
      }

      // 2. Create Order
      const order = await prisma.order.create({
        data: {
          retailerId: retailerProfile.id,
          wholesalerId: wholesalerId,
          totalAmount: totalAmount,
          paymentMethod: paymentMethod,
          status: paymentMethod === 'momo' ? 'pending_payment' : 'pending',
          orderItems: {
            create: items.map((item: any) => ({
              productId: item.product_id,
              quantity: item.quantity,
              price: item.price
            }))
          }
        }
      });

      return order;
    }, { timeout: 15000 });

    res.json({ success: true, order: result });
  } catch (error: any) {
    console.error('Create order failed:', error);
    res.status(500).json({ error: error.message });
  }
};



// ==========================================
// WALLET TRANSACTIONS & CREDIT
// ==========================================

// Get Wallet Transactions
// Get Wallet Transactions
export const getWalletTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { limit = '10', offset = '0' } = req.query;

    // Currently, Retailers do not have a dedicated Wallet Transaction table in the schema.
    // We will serve the Order history as a proxy for "Debit" transactions.
    // Capital Top-ups update the balance but are not logged as transactions yet (pending schema update).

    const orders = await prisma.order.findMany({
      where: { retailerId: retailerProfile.id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    const transactions = orders.map(o => ({
      id: o.id,
      type: 'debit',
      amount: o.totalAmount,
      balance_after: 0, // Not tracked per row
      description: `Order #${o.id.toString().substring(0, 8)}`,
      reference: o.id.toString(),
      status: 'completed',
      created_at: o.createdAt
    }));

    const total = await prisma.order.count({ where: { retailerId: retailerProfile.id } });

    res.json({ transactions, total });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get Credit Info
export const getCreditInfo = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    // Fetch or Create RetailerCredit record
    let retailerCredit = await prisma.retailerCredit.findUnique({
      where: { retailerId: retailerProfile.id }
    });

    if (!retailerCredit) {
      // Initialize if not exists
      retailerCredit = await prisma.retailerCredit.create({
        data: {
          retailerId: retailerProfile.id,
          creditLimit: 0,
          usedCredit: 0,
          availableCredit: 0
        }
      });
    }

    res.json({
      credit: {
        credit_limit: retailerCredit.creditLimit,
        credit_used: retailerCredit.usedCredit,
        credit_available: retailerCredit.availableCredit,
        credit_score: 75, // Static for now, logic can be added later
      }
    });

  } catch (error: any) {
    console.error('Error fetching credit info:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get Credit Orders
export const getCreditOrders = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { status, limit = '10', offset = '0' } = req.query;

    // Define "Credit Orders". For now, we assume any order with status 'credit' or 'pending_payment'
    const where: any = {
      retailerId: retailerProfile.id,
      OR: [
        { status: 'credit' },
        { status: 'pending_payment' }, // Alternative status for credit
        { status: 'overdue' }
      ]
    };

    if (status) {
      where.status = status as string;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { wholesalerProfile: true },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    const total = await prisma.order.count({ where });

    // Map to frontend expectation
    const formattedOrders = orders.map(o => ({
      id: o.id,
      display_id: o.id.toString().substring(0, 8).toUpperCase(),
      wholesaler_name: o.wholesalerProfile?.companyName,
      total_amount: o.totalAmount,
      amount_paid: 0, // In future, check related payments
      amount_pending: o.totalAmount, // Simplified for now
      status: o.status,
      due_date: new Date(new Date(o.createdAt).setDate(new Date(o.createdAt).getDate() + 30)).toISOString(),
      created_at: o.createdAt
    }));

    res.json({ orders: formattedOrders, total });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get Single Credit Order
export const getCreditOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: Number(id) },
      include: { wholesalerProfile: true, orderItems: { include: { product: true } } }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      id: order.id,
      display_id: order.id.toString().substring(0, 8).toUpperCase(),
      wholesaler_name: (order as any).wholesalerProfile?.companyName,
      total_amount: order.totalAmount,
      amount_paid: 0,
      amount_pending: order.totalAmount,
      status: order.status,
      due_date: new Date(new Date(order.createdAt).setDate(new Date(order.createdAt).getDate() + 30)).toISOString(),
      created_at: order.createdAt,
      items: (order as any).orderItems.map((i: any) => ({
        id: i.id,
        product_name: i.product.name,
        quantity: i.quantity,
        price: i.price,
        image: i.product.image
      }))
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Request Credit
export const requestCredit = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Create CreditRequest
    await prisma.creditRequest.create({
      data: {
        retailerId: retailerProfile.id,
        amount: parseFloat(amount),
        reason,
        status: 'pending'
      }
    });

    res.json({ success: true, message: 'Credit request submitted successfully' });

  } catch (error: any) {
    console.error('Error requesting credit:', error);
    res.status(500).json({ error: error.message });
  }
};

// Make Repayment
export const makeRepayment = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) return res.status(404).json({ error: 'Retailer not found' });

    const { id } = req.params; // Order ID
    const { amount, paymentMethod = 'wallet' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid repayment amount' });
    }

    // 1. Get the Order
    const order = await prisma.order.findUnique({ where: { id: Number(id) } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // 2. PalmKash Integration for MoMo
    let externalRef = null;
    if (paymentMethod === 'mobile_money' || paymentMethod === 'momo') {
        const palmKash = (await import('../services/palmKash.service')).default;
        const pmResult = await palmKash.initiatePayment({
            amount: parseFloat(amount),
            phoneNumber: (retailerProfile as any).user?.phone || req.body.phone || '',
            referenceId: `RREPAY-${Date.now()}`,
            description: `Credit Repayment for Order #${id}`
        });

        if (!pmResult.success) {
            return res.status(400).json({ success: false, error: pmResult.error });
        }
        externalRef = pmResult.transactionId;
    }

    // 3. Process Payment
    if (paymentMethod === 'wallet') {
        if (retailerProfile.walletBalance < amount) {
          return res.status(400).json({ error: 'Insufficient wallet balance' });
        }
    }

    // Transaction
    await prisma.$transaction(async (prisma) => {
      // Debit Wallet if chosen
      if (paymentMethod === 'wallet') {
          await prisma.retailerProfile.update({
            where: { id: retailerProfile.id },
            data: { walletBalance: { decrement: amount } }
          });
      }

      // Update Credit Usage (if this was a credit order)
      const creditInfo = await prisma.retailerCredit.findUnique({ where: { retailerId: retailerProfile.id } });
      if (creditInfo) {
        await prisma.retailerCredit.update({
          where: { retailerId: retailerProfile.id },
          data: {
            usedCredit: { decrement: amount },
            availableCredit: { increment: amount }
          }
        });
      }

      // Update Order Status (if fully paid) -- simplistic check
      if (amount >= order.totalAmount) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'completed' } // or 'paid'
        });
      }
    });

    res.json({ success: true, message: 'Repayment successful' });
  } catch (error: any) {
    console.error('Repayment error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// PROFILE MANAGEMENT
// ==========================================

// Get Retailer Profile
export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.user!.id);
    const retailerProfile: any = await prisma.retailerProfile.findUnique({
      where: { userId: userId as any },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            role: true,
            name: true,
          }
        },
        // Include linked wholesaler details
        linkedWholesaler: {
          include: {
            user: {
              select: {
                phone: true,
                email: true,
              }
            }
          }
        }
      }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const profile = {
      // User info nested to match frontend expectation
      user: {
        name: retailerProfile.user?.name,
        email: retailerProfile.user?.email,
        phone: retailerProfile.user?.phone,
      },

      // Retailer specific info
      id: retailerProfile.id,
      companyName: retailerProfile.shopName, // Frontend expects companyName
      shopName: retailerProfile.shopName,
      address: retailerProfile.address,
      contact_person: retailerProfile.user?.name,
      is_verified: retailerProfile.isVerified,
      tinNumber: 'TIN123456789', // Placeholder as it's not in schema yet

      // Linked Wholesaler Info (if linked)
      linkedWholesaler: retailerProfile.linkedWholesaler ? {
        id: retailerProfile.linkedWholesaler.id,
        companyName: retailerProfile.linkedWholesaler.companyName,
        contactPerson: retailerProfile.linkedWholesaler.contactPerson,
        phone: retailerProfile.linkedWholesaler.user?.phone,
        email: retailerProfile.linkedWholesaler.user?.email,
        address: retailerProfile.linkedWholesaler.address,
      } : null,

      // Default Settings
      settings: {
        notifications: {
          push: true,
          email: true,
          sms: true,
          ussd: true
        },
        payment_settings: {
          default_terms: 'net30',
          accepted_methods: ['wallet', 'mobile_money', 'cash']
        }
      }
    };

    res.json({ success: true, profile });
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update Retailer Profile
export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.user!.id);
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: userId as any }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const {
      name, // User name (Contact Person)
      shop_name,
      company_name, // Frontend sends this
      address,
      tin_number,
      email
    } = req.body;

    // Use company_name if shop_name is not provided
    const shopNameUpdate = shop_name || company_name;

    // Update User model if needed
    if (name || email) {
      await prisma.user.update({
        where: { id: userId as any },
        data: {
          ...(name && { name }),
          ...(email && { email })
        }
      });
    }

    // Update RetailerProfile model
    const updatedRetailer = await prisma.retailerProfile.update({
      where: { id: retailerProfile.id },
      data: {
        ...(shopNameUpdate && { shopName: shopNameUpdate }),
        ...(address && { address })
        // tin_number is ignored as it's not in schema
      }
    });

    res.json({ success: true, message: 'Profile updated successfully', profile: updatedRetailer });
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
};

// Top Up Wallet (Add Capital)
export const topUpWallet = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { amount, source } = req.body; // source could be 'mobile_money', 'bank', etc.

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // ==========================================
    // PALMKASH INTEGRATION
    // ==========================================
    let externalRef = null;
    let transactionRef = `TOPUP-${Date.now()}`; // Correct prefix for webhook

    if (source === 'mobile_money' || source === 'momo') {
        const palmKash = (await import('../services/palmKash.service')).default;
        const pmResult = await palmKash.initiatePayment({
            amount: parseFloat(amount),
            phoneNumber: req.body.phone || (retailerProfile as any).user?.phone || '',
            referenceId: transactionRef,
            description: `Retailer Wallet Topup`
        });

        if (!pmResult.success) {
            return res.status(400).json({ success: false, error: pmResult.error });
        }
        externalRef = pmResult.transactionId;
    }

    // Create Pending Transaction
    const transaction = await prisma.walletTransaction.create({
      data: {
        retailerId: retailerProfile.id,
        // walletId is optional now, so we can omit it for retailer
        type: 'topup',
        amount: parseFloat(amount),
        description: `Wallet Topup via ${source}`,
        reference: transactionRef, // Local reference
        status: 'pending'
      }
    });

    res.json({ 
      success: true, 
      message: 'Payment initiated. Please approve on your phone.', 
      transactionId: transactionRef,
      externalRef: externalRef,
      status: 'pending'
    });
  } catch (error: any) {
    console.error('Error adding capital:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get Detailed Analytics
export const getAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const { period = 'month' } = req.query; // week, month, quarter, year

    // 1. Calculate Date Range
    const now = new Date();
    let startDate = new Date();
    if (period === 'week') startDate.setDate(now.getDate() - 7);
    else if (period === 'quarter') startDate.setMonth(now.getMonth() - 3);
    else if (period === 'year') startDate.setFullYear(now.getFullYear() - 1);
    else startDate.setMonth(now.getMonth() - 1); // default month

    // 2. Fetch Sales within Period
    const salesInPeriod = await prisma.sale.findMany({
      where: {
        retailerId: retailerProfile.id,
        createdAt: { gte: startDate }
      },
      include: {
        saleItems: { include: { product: true } },
        consumerProfile: true
      }
    });

    // 3. Revenue Metrics
    const totalRevenue = salesInPeriod.reduce((sum, s) => sum + s.totalAmount, 0);
    const changePercentage = totalRevenue > 0 ? 0 : 0; // Growth calculation requires historical comparison, setting to 0 for literal correctness

    // 4. Daily Revenue (Last 7 Days) - specific for chart
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Group sales by date
    const dailyMap = new Map<string, number>();
    for (let d = new Date(sevenDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
      dailyMap.set(d.toISOString().split('T')[0], 0);
    }

    salesInPeriod.forEach(sale => {
      const dateKey = sale.createdAt.toISOString().split('T')[0];
      if (dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + sale.totalAmount);
      }
    });

    const dailyRevenue = Array.from(dailyMap.entries()).map(([date, amount]) => ({ date, amount }));

    // 5. Sales by Category
    const categoryMap = new Map<string, { count: number, revenue: number }>();
    salesInPeriod.forEach(sale => {
      sale.saleItems.forEach(item => {
        const cat = item.product.category || 'Other';
        const current = categoryMap.get(cat) || { count: 0, revenue: 0 };
        categoryMap.set(cat, {
          count: current.count + item.quantity,
          revenue: current.revenue + (item.price * item.quantity)
        });
      });
    });

    const salesByCategory = Array.from(categoryMap.entries()).map(([category, stats]) => ({
      category,
      count: stats.count,
      revenue: stats.revenue
    }));

    // 6. Top Selling Products
    const productStats = new Map<string, { name: string, quantity: number, revenue: number }>();
    salesInPeriod.forEach(sale => {
      sale.saleItems.forEach(item => {
        const pid = item.productId.toString();
        const current = productStats.get(pid) || { name: item.product.name, quantity: 0, revenue: 0 };
        productStats.set(pid, {
          name: item.product.name,
          quantity: current.quantity + item.quantity,
          revenue: current.revenue + (item.price * item.quantity)
        });
      });
    });

    const topSelling = Array.from(productStats.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // 7. Top Customers
    const customerStats = new Map<string, { name: string, orders: number, spent: number }>();
    salesInPeriod.forEach(sale => {
      if (sale.consumerProfile) {
        const cid = sale.consumerId!.toString();
        const current = customerStats.get(cid) || { name: sale.consumerProfile.fullName || 'Unknown', orders: 0, spent: 0 };
        customerStats.set(cid, {
          name: sale.consumerProfile.fullName || 'Unknown',
          orders: current.orders + 1,
          spent: current.spent + sale.totalAmount
        });
      }
    });

    const topBuyers = Array.from(customerStats.values())
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);

    // 8. Inventory Stats (Snapshot)
    const inventoryCount = await prisma.product.count({
      where: {
        OR: [
          { retailerId: retailerProfile.id },
          { retailerId: null }
        ]
      }
    });

    const allProducts = await prisma.product.findMany({
      where: {
        OR: [
          { retailerId: retailerProfile.id },
          { retailerId: null }
        ]
      }
    });
    const actualLowStock = allProducts.filter(p => p.lowStockThreshold && p.stock <= p.lowStockThreshold).length;


    res.json({
      revenue: {
        total: totalRevenue,
        change: changePercentage,
        daily: dailyRevenue
      },
      sales: {
        total: salesInPeriod.length,
        change: 12.5,
        byCategory: salesByCategory
      },
      products: {
        total: inventoryCount,
        lowStock: actualLowStock,
        topSelling: topSelling
      },
      customers: {
        total: customerStats.size,
        newThisMonth: 0,
        topBuyers: topBuyers
      }
    });

  } catch (error: any) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// WHOLESALER DISCOVERY & LINK REQUEST APIs
// ==========================================

// Get available wholesalers for retailer to discover
export const getAvailableWholesalers = async (req: AuthRequest, res: Response) => {
  try {
    const { search } = req.query;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    // Get ALL wholesalers for discovery (retailers can send link requests to any wholesaler)
    const where: any = {};
    if (search) {
      where.companyName = { contains: search as string };
    }

    const wholesalers = await prisma.wholesalerProfile.findMany({
      where,
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            isActive: true,
          }
        },
        linkedRetailers: {
          select: { id: true }
        },
        inventory: {
          where: { stock: { gt: 0 } },
          select: { id: true }
        }
      }
    });

    // Get existing link requests from this retailer
    const existingRequests = await prisma.linkRequest.findMany({
      where: { retailerId: retailerProfile.id },
      select: { wholesalerId: true, status: true }
    });

    const requestMap = new Map(existingRequests.map(r => [r.wholesalerId, r.status]));

    // Format response
    const formattedWholesalers = wholesalers
      .filter(w => w.user?.isActive)
      .map(w => ({
        id: w.id,
        companyName: w.companyName,
        contactPerson: w.contactPerson,
        address: w.address,
        phone: w.user?.phone,
        email: w.user?.email,
        isVerified: w.isVerified,
        retailerCount: w.linkedRetailers?.length || 0,
        productCount: w.inventory?.length || 0,
        // Link status for this retailer
        isLinked: retailerProfile.linkedWholesalerId === w.id,
        requestStatus: requestMap.get(w.id) || null, // pending, approved, rejected, or null
      }));

    res.json({
      success: true,
      wholesalers: formattedWholesalers,
      total: formattedWholesalers.length,
      currentLinkedWholesalerId: retailerProfile.linkedWholesalerId
    });
  } catch (error: any) {
    console.error('Error fetching wholesalers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Send link request to wholesaler
// RULE: Retailer can send request to ONLY ONE wholesaler at a time
export const sendLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { wholesalerId, message } = req.body;

    if (!wholesalerId) {
      return res.status(400).json({ success: false, error: 'Wholesaler ID is required' });
    }

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    // Check if already linked to a wholesaler
    if (retailerProfile.linkedWholesalerId) {
      return res.status(400).json({
        success: false,
        error: 'You are already linked to a wholesaler. Retailers can only be linked to one wholesaler.'
      });
    }

    // IMPORTANT: Check if retailer already has ANY pending request
    const anyPendingRequest = await prisma.linkRequest.findFirst({
      where: {
        retailerId: retailerProfile.id,
        status: 'pending'
      },
      include: {
        wholesaler: { select: { companyName: true } }
      }
    });

    if (anyPendingRequest) {
      return res.status(400).json({
        success: false,
        error: `You already have a pending request to ${anyPendingRequest.wholesaler.companyName}. You can only send one request at a time. Cancel the existing request to send a new one.`,
        existingRequestId: anyPendingRequest.id,
        existingWholesalerId: anyPendingRequest.wholesalerId
      });
    }

    // Check if wholesaler exists
    const wholesaler = await prisma.wholesalerProfile.findUnique({
      where: { id: wholesalerId }
    });

    if (!wholesaler) {
      return res.status(404).json({ success: false, error: 'Wholesaler not found' });
    }

    // Check for existing request to THIS wholesaler
    const existingRequest = await prisma.linkRequest.findUnique({
      where: {
        retailerId_wholesalerId: {
          retailerId: retailerProfile.id,
          wholesalerId: wholesalerId
        }
      }
    });

    if (existingRequest) {
      if (existingRequest.status === 'approved') {
        return res.status(400).json({
          success: false,
          error: 'Your request was already approved. Contact admin if not linked.'
        });
      }
      // If rejected, allow to send again - update the existing request
      if (existingRequest.status === 'rejected') {
        const updatedRequest = await prisma.linkRequest.update({
          where: { id: existingRequest.id },
          data: {
            status: 'pending',
            message: message || null,
            rejectionReason: null,
            respondedAt: null,
            updatedAt: new Date()
          }
        });

        return res.json({
          success: true,
          message: 'Link request re-sent successfully',
          request: updatedRequest
        });
      }
    }

    // Create new link request
    const linkRequest = await prisma.linkRequest.create({
      data: {
        retailerId: retailerProfile.id,
        wholesalerId: wholesalerId,
        message: message || null,
        status: 'pending'
      }
    });

    res.json({
      success: true,
      message: 'Link request sent successfully',
      request: linkRequest
    });
  } catch (error: any) {
    console.error('Error sending link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get my link requests (for retailer)
export const getMyLinkRequests = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const requests = await prisma.linkRequest.findMany({
      where: { retailerId: retailerProfile.id },
      include: {
        wholesaler: {
          include: {
            user: {
              select: { phone: true, email: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedRequests = requests.map(r => ({
      id: r.id,
      wholesalerId: r.wholesalerId,
      wholesalerName: r.wholesaler.companyName,
      wholesalerPhone: r.wholesaler.user?.phone,
      wholesalerAddress: r.wholesaler.address,
      status: r.status,
      message: r.message,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt
    }));

    res.json({
      success: true,
      requests: formattedRequests
    });
  } catch (error: any) {
    console.error('Error fetching link requests:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Cancel link request (for retailer)
export const cancelLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const request = await prisma.linkRequest.findFirst({
      where: {
        id: parseInt(requestId),
        retailerId: retailerProfile.id,
        status: 'pending'
      }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Pending request not found' });
    }

    await prisma.linkRequest.delete({
      where: { id: request.id }
    });

    res.json({
      success: true,
      message: 'Link request cancelled successfully'
    });
  } catch (error: any) {
    console.error('Error cancelling link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// CUSTOMER LINK REQUEST MANAGEMENT (Retailer Side)
// ==========================================

// Get customer link requests for this retailer
export const getCustomerLinkRequests = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const whereClause: any = { retailerId: retailerProfile.id };
    if (status) {
      whereClause.status = status as string;
    }

    const requests = await prisma.customerLinkRequest.findMany({
      where: whereClause,
      include: {
        customer: {
          include: {
            user: {
              select: { name: true, phone: true, email: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate stats
    const allRequests = await prisma.customerLinkRequest.findMany({
      where: { retailerId: retailerProfile.id }
    });

    const stats = {
      pending: allRequests.filter(r => r.status === 'pending').length,
      approved: allRequests.filter(r => r.status === 'approved').length,
      rejected: allRequests.filter(r => r.status === 'rejected').length,
      total: allRequests.length
    };

    const formattedRequests = requests.map(r => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customer.fullName || r.customer.user?.name || 'Unknown',
      customerPhone: r.customer.user?.phone,
      customerEmail: r.customer.user?.email,
      customerAddress: r.customer.address,
      isVerified: r.customer.isVerified,
      status: r.status,
      message: r.message,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt
    }));

    res.json({ success: true, requests: formattedRequests, stats });
  } catch (error: any) {
    console.error('Error fetching customer link requests:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve a customer link request
export const approveCustomerLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const request = await prisma.customerLinkRequest.findFirst({
      where: {
        id: parseInt(requestId),
        retailerId: retailerProfile.id,
        status: 'pending'
      },
      include: { customer: true }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Pending request not found' });
    }

    // NEW: Customer can be linked to MULTIPLE retailers
    // No need to check if already linked elsewhere - just approve this request
    // The CustomerLinkRequest table tracks per-retailer approval status

    // Update request status to approved
    await prisma.customerLinkRequest.update({
      where: { id: request.id },
      data: {
        status: 'approved',
        respondedAt: new Date()
      }
    });

    res.json({ success: true, message: 'Customer link request approved successfully' });
  } catch (error: any) {
    console.error('Error approving customer link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject a customer link request
export const rejectCustomerLinkRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const request = await prisma.customerLinkRequest.findFirst({
      where: {
        id: parseInt(requestId),
        retailerId: retailerProfile.id,
        status: 'pending'
      }
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Pending request not found' });
    }

    await prisma.customerLinkRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        rejectionReason: reason || null,
        respondedAt: new Date()
      }
    });

    res.json({ success: true, message: 'Customer link request rejected' });
  } catch (error: any) {
    console.error('Error rejecting customer link request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get linked customers for this retailer
export const getLinkedCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    // NEW: Query CustomerLinkRequest table for approved customers
    const approvedLinks = await prisma.customerLinkRequest.findMany({
      where: {
        retailerId: retailerProfile.id,
        status: 'approved'
      },
      include: {
        customer: {
          include: {
            user: {
              select: { name: true, phone: true, email: true }
            },
            sales: {
              where: { retailerId: retailerProfile.id },
              select: { id: true, totalAmount: true }
            }
          }
        }
      }
    });

    const formattedCustomers = approvedLinks.map(link => {
      const c = link.customer;
      return {
        id: c.id,
        name: c.fullName || c.user?.name || 'Unknown',
        phone: c.user?.phone,
        email: c.user?.email,
        address: c.address,
        isVerified: c.isVerified,
        membershipType: c.membershipType,
        orderCount: c.sales.length,
        totalPurchased: c.sales.reduce((sum, s) => sum + s.totalAmount, 0)
      };
    });

    res.json({ success: true, customers: formattedCustomers, total: formattedCustomers.length });
  } catch (error: any) {
    console.error('Error fetching linked customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Unlink a customer
export const unlinkCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const { customerId } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    // NEW: Find and delete the CustomerLinkRequest record
    const linkRequest = await prisma.customerLinkRequest.findUnique({
      where: {
        customerId_retailerId: {
          customerId: parseInt(customerId),
          retailerId: retailerProfile.id
        }
      }
    });

    if (!linkRequest) {
      return res.status(404).json({ success: false, error: 'Linked customer not found' });
    }

    // Delete the link request to unlink the customer
    await prisma.customerLinkRequest.delete({
      where: { id: linkRequest.id }
    });

    res.json({ success: true, message: 'Customer unlinked successfully' });
  } catch (error: any) {
    console.error('Error unlinking customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==========================================
// SETTLEMENT INVOICES (Read-only for Retailer)
// ==========================================

// Get assigned settlement invoices for this retailer
export const getSettlementInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const where: any = {
      retailerId: retailerProfile.id,
      partyType: 'retailer'
    };

    if (month) {
      where.settlementMonth = month as string;
    }

    const invoices = await prisma.settlementInvoice.findMany({
      where,
      orderBy: { settlementMonth: 'desc' }
    });

    res.json({
      success: true,
      invoices,
      total: invoices.length
    });
  } catch (error: any) {
    console.error('Get Settlement Invoices Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single settlement invoice detail
export const getSettlementInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ success: false, error: 'Retailer profile not found' });
    }

    const invoice = await prisma.settlementInvoice.findFirst({
      where: {
        id: Number(id),
        retailerId: retailerProfile.id
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

// Get Retailer Purchase Orders (Wholesale Orders)
export const getPurchaseOrders = async (req: AuthRequest, res: Response) => {
  try {
    const { status, limit = 10, offset = 0 } = req.query;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const where: any = { retailerId: retailerProfile.id };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          wholesalerProfile: true,
          orderItems: {
            include: {
              product: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset)
      }),
      prisma.order.count({ where })
    ]);

    const formattedOrders = orders.map(order => ({
      id: order.id,
      wholesaler_name: order.wholesalerProfile?.companyName || 'Unknown Wholesaler',
      total_amount: order.totalAmount,
      status: order.status,
      payment_method: order.paymentMethod,
      created_at: order.createdAt,
      items_count: order.orderItems.length
    }));

    res.json({
      orders: formattedOrders,
      total,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error: any) {
    console.error('❌ Error fetching purchase orders:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get Single Purchase Order Detail
export const getPurchaseOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const retailerProfile = await prisma.retailerProfile.findUnique({
      where: { userId: req.user!.id }
    });

    if (!retailerProfile) {
      return res.status(404).json({ error: 'Retailer profile not found' });
    }

    const order = await prisma.order.findUnique({
      where: {
        id: Number(id),
        retailerId: retailerProfile.id
      },
      include: {
        wholesalerProfile: true,
        orderItems: {
          include: {
            product: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const formattedOrder = {
      id: order.id,
      wholesaler_name: order.wholesalerProfile?.companyName || 'Unknown Wholesaler',
      total_amount: order.totalAmount,
      status: order.status,
      payment_method: order.paymentMethod,
      created_at: order.createdAt,
      items: order.orderItems.map(item => ({
        id: item.id,
        product_name: item.product?.name || 'Unknown Product',
        quantity: item.quantity,
        price: item.price,
        total: item.quantity * item.price,
        image: item.product.image
      }))
    };

    res.json({ order: formattedOrder });
  } catch (error: any) {
    console.error('❌ Error fetching purchase order detail:', error);
    res.status(500).json({ error: error.message });
  }
};
