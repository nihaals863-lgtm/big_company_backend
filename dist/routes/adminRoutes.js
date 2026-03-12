"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController_1 = require("../controllers/adminController");
const supplierController_1 = require("../controllers/supplierController");
const recruitmentController_1 = require("../controllers/recruitmentController");
const dealsController_1 = require("../controllers/dealsController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const readOnlyMiddleware_1 = require("../middleware/readOnlyMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticate);
router.use(readOnlyMiddleware_1.enforceReadOnly);
router.get('/dashboard', adminController_1.getDashboard);
// Customer Routes
router.get('/customers', adminController_1.getCustomers);
router.get('/customers/:id', adminController_1.getCustomer);
router.post('/customers', adminController_1.createCustomer);
router.put('/customers/:id', adminController_1.updateCustomer);
router.delete('/customers/:id', adminController_1.deleteCustomer);
router.put('/customers/:id/status', adminController_1.updateCustomerStatus);
// Retailer Routes
router.get('/retailers', adminController_1.getRetailers);
router.post('/retailers', adminController_1.createRetailer);
router.put('/retailers/:id', adminController_1.updateRetailer);
router.delete('/retailers/:id', adminController_1.deleteRetailer);
router.post('/retailers/:id/verify', adminController_1.verifyRetailer);
router.post('/retailers/:id/status', adminController_1.updateRetailerStatus);
// Wholesaler Routes
router.get('/wholesalers', adminController_1.getWholesalers);
router.post('/wholesalers', adminController_1.createWholesaler);
router.put('/wholesalers/:id', adminController_1.updateWholesaler);
router.delete('/wholesalers/:id', adminController_1.deleteWholesaler);
router.post('/wholesalers/:id/status', adminController_1.updateWholesalerStatus);
router.post('/wholesalers/:id/verify', adminController_1.verifyWholesaler);
router.get('/loans', adminController_1.getLoans);
router.post('/loans/:id/approve', adminController_1.approveLoan);
router.post('/loans/:id/reject', adminController_1.rejectLoan);
router.get('/nfc-cards', adminController_1.getNFCCards);
router.post('/nfc-cards', adminController_1.registerNFCCard);
router.put('/nfc-cards/:id/block', adminController_1.blockNFCCard);
router.put('/nfc-cards/:id/activate', adminController_1.activateNFCCard);
router.put('/nfc-cards/:id/unlink', adminController_1.unlinkNFCCard);
// Product Routes
router.get('/products', adminController_1.getProducts);
router.post('/products', adminController_1.createProduct);
router.put('/products/:id', adminController_1.updateProduct);
router.delete('/products/:id', adminController_1.deleteProduct);
// Category Routes
router.get('/categories', adminController_1.getCategories);
router.post('/categories', adminController_1.createCategory);
router.put('/categories/:id', adminController_1.updateCategory);
router.delete('/categories/:id', adminController_1.deleteCategory);
// Supplier Routes
router.get('/suppliers', supplierController_1.getSuppliers);
router.post('/suppliers', supplierController_1.createSupplier);
router.put('/suppliers/:id', supplierController_1.updateSupplier);
router.delete('/suppliers/:id', supplierController_1.deleteSupplier);
// Recruitment Routes
router.get('/jobs', recruitmentController_1.getJobs);
router.post('/jobs', recruitmentController_1.createJob);
router.put('/jobs/:id', recruitmentController_1.updateJob);
router.delete('/jobs/:id', recruitmentController_1.deleteJob);
router.get('/applications', recruitmentController_1.getApplications);
router.post('/applications', recruitmentController_1.createApplication);
router.put('/applications/:id/status', recruitmentController_1.updateApplicationStatus);
// Deals Routes
router.get('/deals', dealsController_1.getDeals);
router.post('/deals', dealsController_1.createDeal);
router.put('/deals/:id', dealsController_1.updateDeal);
router.delete('/deals/:id', dealsController_1.deleteDeal);
// Employee Routes
router.get('/employees', adminController_1.getEmployees);
router.post('/employees', adminController_1.createEmployee);
router.put('/employees/:id', adminController_1.updateEmployee);
router.delete('/employees/:id', adminController_1.deleteEmployee);
// Report Routes
router.get('/reports', adminController_1.getReports);
router.get('/reports/transactions', adminController_1.getTransactionReport);
router.get('/reports/revenue', adminController_1.getRevenueReport);
// System Config Routes
router.get('/system-config', adminController_1.getSystemConfig);
router.put('/system-config', adminController_1.updateSystemConfig);
// ==========================================
// REAL-TIME READ-ONLY ACCOUNT ACCESS ROUTES
// ==========================================
// Customer account details (READ-ONLY for Admin)
router.get('/customers/:id/account-details', adminController_1.getCustomerAccountDetails);
// Retailer account details (READ-ONLY for Admin)
router.get('/retailers/:id/account-details', adminController_1.getRetailerAccountDetails);
// Worker/Employee account details (READ-ONLY for Admin)
router.get('/employees/:id/account-details', adminController_1.getWorkerAccountDetails);
// Wholesaler account details (READ-ONLY for Admin)
router.get('/wholesalers/:id/account-details', adminController_1.getWholesalerAccountDetails);
// ==========================================
// WHOLESALER-RETAILER LINKAGE ROUTES
// ==========================================
router.get('/linkage', adminController_1.getRetailerWholesalerLinkage);
router.post('/linkage/link', adminController_1.linkRetailerToWholesaler);
router.post('/linkage/unlink', adminController_1.unlinkRetailerFromWholesaler);
// ==========================================
// SETTLEMENT INVOICE ROUTES
// ==========================================
router.get('/settlement-invoices', adminController_1.getSettlementInvoices);
router.post('/settlement-invoices', adminController_1.createSettlementInvoice);
router.get('/settlement-invoices/:id', adminController_1.getSettlementInvoice);
router.put('/settlement-invoices/:id', adminController_1.updateSettlementInvoice);
router.delete('/settlement-invoices/:id', adminController_1.deleteSettlementInvoice);
exports.default = router;
