export function categorizeMessage(tokens) {
    const keywords = {
        'bill_inquiry': ['bill', 'invoice', 'payment', 'due', 'amount', 'balance'],
        'power_rate': ['rate', 'rates', 'cost', 'tariff', 'charge', 'price', 'kwh', 'cost'],
        'power_interruption': ['interruption', 'outage', 'electricity', 'shutdown', 'blackout','kuryente','report'],
        'account_concern': ['account', 'issue', 'concern', 'error', 'service','apply','connection'],
    };

    let category = 'unknown';

    for (const [key, value] of Object.entries(keywords)) {
        for (let word of value) {
            if (tokens.includes(word)) {
                category = key;
                break;
            }
        }
        if (category !== 'unknown') break;
    }

    return category;
}