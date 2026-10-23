// Vercel 서버 함수: 사진(KDS 화면)을 Claude에 보내 주문 목록(JSON)을 받아온다.
// Vercel 프로젝트 환경변수 ANTHROPIC_API_KEY 필요 (키는 브라우저에 노출되지 않음)
const PROMPT = "이 이미지는 투썸플레이스 주방 KDS(주문내역 화면) 사진입니다. 화면에는 주문 카드(티켓)가 격자로 배열되어 있고, 카드 한 칸이 주문 1건입니다. 카드 왼쪽 위에 주문번호(예: 01-0041, 02-0060), 그 아래 접수시각(예: 14:18:34)이 있고, 그 아래에 품목이 줄줄이 나열되며 각 줄 오른쪽에 수량 숫자가 있습니다. 품목명은 'ice아메리카노R', '바닐라 라떼R', 'ice아메리카노아로마R' 처럼 'ice'(아이스) + 메뉴명 + 사이즈(R/L/M)가 공백 없이 붙어 표기됩니다. 화면에 보이는 모든 카드를 빠짐없이 읽고, 각 카드의 품목을 그 카드 안에 묶어서 적으세요(노란색 강조 줄 포함, 화면 가장자리에 일부 잘린 카드·줄도 읽을 수 있는 만큼). 케이크·초 등 음료가 아닌 품목도 이름 그대로 포함하세요. 카드 상단의 '총N개' 숫자와 품목 수량 합이 맞는지 확인하세요. 오직 JSON 배열로만 답하고 다른 설명이나 코드블록 표시는 쓰지 마세요: [{\"ticket\":\"주문번호\",\"time\":\"HH:MM:SS\",\"items\":[{\"name\":\"화면 표기 그대로(ice·사이즈 포함)\",\"qty\":수량}]}]";

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요' });
  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== 'string' || image.length > 6_000_000) {
    return res.status(400).json({ error: '이미지가 없거나 너무 커요' });
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } },
          { type: 'text', text: PROMPT }
        ]}]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || ('Claude API 오류 ' + r.status) });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
