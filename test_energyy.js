const axios = require('axios');

async function testApi() {
    const baseUrl = 'http://english.energyy.ucskype.com';
    const loginPayload = {
        action: "lorawanMeter",
        method: "toLogin",
        params: { username: 'Rwanda_Kayitare', password: '123456' }
    };
    
    try {
        const loginResp = await axios.post(`${baseUrl}/api/commonInternal.jsp`, 
            'requestParams=' + encodeURIComponent(JSON.stringify(loginPayload)), 
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const token = loginResp.data?.value?.apiToken;
        
        const meterNo = '865395070835713';
        const tryLorawan = async (action, method, paramKey, val) => {
            const p = {
                action: action, method: method, apiToken: token,
                param: { [paramKey]: val, token: "12345678901234567890" }
            };
            try {
                const resp = await axios.post(`${baseUrl}/api/commonInternal.jsp`, 
                    'requestParams=' + encodeURIComponent(JSON.stringify(p)), 
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                );
                console.log(action, method, ':', resp.data);
            } catch(e) { console.log(action, method, 'Error:', e.response?.data || e.message); }
        };

        // Let's test what rechargeToken does under zlMeter
        await tryLorawan("zlMeter", "rechargeToken", "imei", meterNo);
        
    } catch (e) {
        console.error('Error:', e.message);
    }
}
testApi();
