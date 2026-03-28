import axios from 'axios';

export interface PipingMeterRechargeParams {
    meterNumber: string;
    amount?: number;       // Now optional if token is provided
    token?: string;        // Added for token-based recharge
    customerRef: string;   // Internal tracking reference
    customerPhone?: string;
}

export interface PipingMeterRechargeResult {
    success: boolean;
    meterNumber?: string;
    amount?: number;
    units?: number;
    apiReference?: string;   // orderId from Lorawan API
    message?: string;
    error?: string;
}

// async function rechargePipingGasMeter(meterNo: string, amount: number) {
//     // 1. Call login API
//     const loginPayload = {
//       action: "lorawanMeter",
//       method: "toLogin",
//       params: {
//         username: "Rwanda_Kayitare",
//         password: "123456"
//       }
//     };

//     const loginResponse = await axios.post(
//       "http://english.energyy.ucskype.com/api/commonInternal.jsp",
//       `requestParams=${encodeURIComponent(JSON.stringify(loginPayload))}`,
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     // 2. Extract apiToken
//     const apiToken = loginResponse.data?.value?.apiToken;

//     if (!apiToken) {
//         throw new Error("Failed to get API Token from Login");
//     }

//     // 3. Call recharge API
//     const rechargePayload = {
//       action: "lorawanMeter",
//       method: "recharge",
//       params: {
//         meterNo: meterNo,
//         amount: String(amount),
//         apiToken: apiToken
//       }
//     };

//     const rechargeResponse = await axios.post(
//       "http://english.energyy.ucskype.com/api/commonInternal.jsp",
//       `requestParams=${encodeURIComponent(JSON.stringify(rechargePayload))}`,
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     // 4. Return response
//     return rechargeResponse.data;
// }
async function callPipingMeterApi(params: { devEui: string, amount?: number, token?: string }) {
    const baseUrl = process.env.LORAWAN_BASE_URL || 'http://english.energyy.ucskype.com';
    const username = process.env.LORAWAN_USERNAME || 'Rwanda_Kayitare';
    const password = process.env.LORAWAN_PASSWORD || '123456';

    const loginPayload = {
        action: "lorawanMeter",
        method: "toLogin",
        params: { username, password }
    };

    const loginResponse = await axios.post(
        `${baseUrl}/api/commonInternal.jsp`,
        `requestParams=${encodeURIComponent(JSON.stringify(loginPayload))}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const apiToken = loginResponse.data?.value?.apiToken;

    if (!apiToken) {
        throw new Error("Failed to get API Token from Login");
    }

    if (!params.token) {
        let respData: any = null;

        // --- ATTEMPT 1: zlMeter / remotelyTopUp (Verified System Logic) ---
        try {
            console.log(`[PipingMeter] Attempt 1 (remotelyTopUp) for ${params.devEui}...`);
            const payload1 = {
                action: "lorawanMeter",
                method: "remotelyTopUp",
                apiToken: apiToken,
                param: {
                    devEui: params.devEui,
                    topUpAmount: String(params.amount || 0),
                    topUpToDeviceAmount: String(params.amount || 0)
                }
            };

            const resp1 = await axios.post(
                `${baseUrl}/api/commonInternal.jsp`,
                `requestParams=${encodeURIComponent(JSON.stringify(payload1))}`,
                { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
            );

            console.log(`[PipingMeter] Attempt 1 result for ${params.devEui}:`, resp1.data);
            
            const msg = (resp1.data?.msg || resp1.data?.errmsg || "").toLowerCase();
            if (resp1.data?.errcode === "0" || resp1.data?.errcode === 0 || (!msg.includes("not found") && resp1.data?.success)) {
                 return resp1.data;
            }
            respData = resp1.data; 
        } catch (err1: any) {
            console.error(`[PipingMeter] Attempt 1 failed with HTTP error: ${err1.message}`);
        }

        // --- ATTEMPT 2: lorawanMeter / recharge (Classic GPRS Fallback) ---
        try {
            console.log(`[PipingMeter] Attempt 2 (recharge) for ${params.devEui} (Fallback)...`);
            const payload2 = {
                action: "lorawanMeter",
                method: "recharge",
                params: {
                    devEui: params.devEui,
                    amount: String(params.amount || 0),
                    apiToken: apiToken
                }
            };

            const resp2 = await axios.post(
                `${baseUrl}/api/commonInternal.jsp`,
                `requestParams=${encodeURIComponent(JSON.stringify(payload2))}`,
                { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
            );

            console.log(`[PipingMeter] Attempt 2 result for ${params.devEui}:`, resp2.data);
            return resp2.data;
        } catch (err2: any) {
            console.error(`[PipingMeter] Attempt 2 failed with HTTP error: ${err2.message}`);
            if (respData) return respData;
            throw err2;
        }
    }

    // Token Push Mode requires 'zlMeter' and 'rechargeToken'
    const method = 'rechargeToken';
    const methodParams: any = {
        imei: params.devEui,
        token: params.token
    };

    const rechargePayload = {
        action: "zlMeter",
        method,
        apiToken: apiToken,
        param: methodParams
    };

    const rechargeResponse = await axios.post(
        `${baseUrl}/api/commonInternal.jsp`,
        `requestParams=${encodeURIComponent(JSON.stringify(rechargePayload))}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    return rechargeResponse.data;
}

class PipingMeterService {

    async rechargePipingMeter(params: PipingMeterRechargeParams): Promise<PipingMeterRechargeResult> {
        try {
            const unitsAmount = this.calculateUnits(params.amount || 0);

            const apiParams = {
                devEui: params.meterNumber,
                amount: unitsAmount,
                token: params.token
            };

            const response = await callPipingMeterApi(apiParams);

            if (response && (response.success || response.errcode === "0" || response.errcode === 0)) {
                return {
                    success: true,
                    meterNumber: params.meterNumber,
                    amount: params.amount,
                    units: unitsAmount,
                    apiReference: response.value?.id || `PIPING-${Date.now()}`,
                    message: response.msg || response.errmsg || 'Piping Meter recharge successful',
                };
            } else {
                return {
                    success: false,
                    error: response.msg || response.errmsg || 'Piping API Rejection',
                };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Piping API call failed'
            };
        }
    }

    private calculateUnits(amountRwf: number): number {
        const ratePerM3 = Number(process.env.LORAWAN_RATE_PER_M3) || 850;
        return parseFloat((amountRwf / ratePerM3).toFixed(4));
    }
}

export default new PipingMeterService();
