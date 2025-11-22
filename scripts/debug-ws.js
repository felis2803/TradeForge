// Quick debug script to check if trades are coming through WebSocket

const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
    console.log('✅ Connected to dashboard WebSocket');
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'trade') {
        console.log('📊 Trade received:', {
            botId: msg.botId,
            price: msg.data.price,
            qty: msg.data.qty,
            side: msg.data.side,
            ts: new Date(msg.data.ts * 1000).toLocaleTimeString()
        });
    }

    if (msg.type === 'botList') {
        console.log('🤖 Bots:', msg.data.map(b => b.name));
    }
};

ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
};

ws.onclose = () => {
    console.log('🔌 Disconnected from WebSocket');
};

console.log('🔍 Listening for trade events...');
