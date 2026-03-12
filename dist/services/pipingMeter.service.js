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
const axios_1 = __importDefault(require("axios"));
class PipingMeterService {
    constructor() {
        // Stronpower API base URL (from swagger docs: http://www.server-newv.stronpower.com)
        this.apiBaseUrl = process.env.PIPING_METER_API_URL || 'http://www.server-newv.stronpower.com/api';
        this.apiKey = process.env.PIPING_METER_API_KEY || '';
        this.apiSecret = process.env.PIPING_METER_API_SECRET || '';
        this.companyCode = process.env.PIPING_METER_COMPANY_CODE || '';
    }
    /**
     * Main public method: recharge a piping gas meter directly.
     * Makes API call to Stronpower system which directly credits the meter.
     */
    rechargePipingMeter(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
            const isDev = process.env.DEV_MODE === 'true' || process.env.DEV_MODE === '1';
            if (isDev) {
                console.log(`🛠️ [PipingMeter DEV MODE] Simulating recharge for meter: ${params.meterNumber}, Amount: ${params.amount}`);
                const units = this.calculateUnits(params.amount);
                return {
                    success: true,
                    meterNumber: params.meterNumber,
                    amount: params.amount,
                    units,
                    apiReference: `DEV-PIPE-${Date.now()}`,
                    message: `Piping meter recharged successfully with ${units} m³ (DEV_MODE)`,
                };
            }
            try {
                // Stronpower API recharge endpoint (based on swagger documentation)
                const requestBody = {
                    meter_no: params.meterNumber,
                    recharge_amount: params.amount,
                    currency: 'RWF',
                    company_code: this.companyCode,
                    order_no: params.customerRef,
                    customer_phone: params.customerPhone || '',
                };
                const requestHeaders = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-Api-Key': this.apiKey,
                    'X-Api-Secret': this.apiSecret,
                };
                console.log(`🚀 [PipingMeter] Recharging meter ${params.meterNumber}, Amount: ${params.amount}`);
                console.log('[PipingMeter] Request body:', JSON.stringify(requestBody, null, 2));
                const response = yield axios_1.default.post(`${this.apiBaseUrl}/recharge/meter`, requestBody, {
                    headers: requestHeaders,
                    timeout: 20000,
                    validateStatus: (status) => status < 500,
                });
                console.log(`[PipingMeter] Response status: ${response.status}`);
                console.log('[PipingMeter] Response data:', JSON.stringify(response.data, null, 2));
                if (response.status >= 400) {
                    return {
                        success: false,
                        error: ((_a = response.data) === null || _a === void 0 ? void 0 : _a.message) || ((_b = response.data) === null || _b === void 0 ? void 0 : _b.error) || `API error: HTTP ${response.status}`,
                    };
                }
                // Parse success from response - Stronpower API may use different success indicators
                const isSuccess = ((_c = response.data) === null || _c === void 0 ? void 0 : _c.success) === true ||
                    ((_d = response.data) === null || _d === void 0 ? void 0 : _d.status) === 'SUCCESS' ||
                    ((_e = response.data) === null || _e === void 0 ? void 0 : _e.code) === 0 ||
                    ((_f = response.data) === null || _f === void 0 ? void 0 : _f.result_code) === '00' ||
                    ((_h = (_g = response.data) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.status) === 'SUCCESS';
                if (!isSuccess) {
                    return {
                        success: false,
                        error: ((_j = response.data) === null || _j === void 0 ? void 0 : _j.message) || ((_k = response.data) === null || _k === void 0 ? void 0 : _k.error) || 'Piping meter recharge was rejected by API',
                    };
                }
                const units = ((_l = response.data) === null || _l === void 0 ? void 0 : _l.units) || ((_o = (_m = response.data) === null || _m === void 0 ? void 0 : _m.data) === null || _o === void 0 ? void 0 : _o.units) || this.calculateUnits(params.amount);
                const apiRef = ((_p = response.data) === null || _p === void 0 ? void 0 : _p.reference) ||
                    ((_q = response.data) === null || _q === void 0 ? void 0 : _q.transaction_id) ||
                    ((_s = (_r = response.data) === null || _r === void 0 ? void 0 : _r.data) === null || _s === void 0 ? void 0 : _s.order_no) ||
                    ((_t = response.data) === null || _t === void 0 ? void 0 : _t.order_no);
                return {
                    success: true,
                    meterNumber: params.meterNumber,
                    amount: params.amount,
                    units,
                    apiReference: String(apiRef || params.customerRef),
                    message: ((_u = response.data) === null || _u === void 0 ? void 0 : _u.message) || 'Piping meter recharged successfully',
                };
            }
            catch (error) {
                console.error('[PipingMeter] API Error:', ((_v = error.response) === null || _v === void 0 ? void 0 : _v.data) || error.message);
                return {
                    success: false,
                    error: ((_x = (_w = error.response) === null || _w === void 0 ? void 0 : _w.data) === null || _x === void 0 ? void 0 : _x.message) || error.message || 'Failed to connect to Piping Meter API',
                };
            }
        });
    }
    /**
     * Calculate approximate gas units for a given RWF amount.
     * Piping gas is measured in m³. Rate: ~850 RWF per m³ (from system config).
     */
    calculateUnits(amountRwf) {
        return parseFloat((amountRwf / 850).toFixed(4));
    }
}
exports.default = new PipingMeterService();
