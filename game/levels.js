// 噹噹噹! 病人怎麼了? · the nine levels (關卡), from 「EKG」 story sheets.
// Everything a player reads in a level is data here; game.js only plays it.
//
// A level is a short branching story at one bedside. The nurse starts with 3 hearts: a wrong
// choice costs one (`cost`), and with none left the story ends. Reaching a `win` with at least
// one heart left earns a coin.
//
//   level  { n, bed, name, focus, patient, ecg0, bell, start, nodes, card, sbar }
//     n          the level (and room) number on the station board
//     bed        bed id without the ward, like '02A'
//     patient    'sit' (awake, on the phone) or 'lie'
//     ecg0       the strip on the monitor when the nurse walks in; the first level starts with a lead off
//     bell       what rings at the station: { who, text, go, options? }. With `options`, the nurse
//                decides there whether to go ({ t, cost, say }); otherwise there is just 「我現在過去」
//   node   one screen of the story
//     t          the text: one line, or an array of lines
//     ecg        switches the strip to this rhythm (rhythms in ecg.js), with `hr`
//     monitor    the nurse has to tap the monitor and watch the strip, then the story goes on to `next`
//     vitals     { bp, hr }: shown as the nurse's measurements
//     senior     the senior nurse (學姊) steps into the room: 'stern' or 'cry'
//     opts       choices: { t, to, cost }. `quiz: 'read'` on the node scores a rhythm reading
//     next       a single way on (a 「繼續」 button)
//     cpr        chest compressions to the beat, then `next`
//     end        the story is over: 'win' | 'fail' (patient not stabilised) | 'dead' (patient dies)
//                | 'you' (the trainee is "out", the senior kneels in tears)
//
// Medical content here is for teaching practice. Have your unit's educators check it against
// your hospital's own protocols (see README.md).

// the standard procedure for an alarm or an abnormal rhythm (作業標準), shown from the bedside
export const FLOW = {
  title: '當心電圖出現異常心律或發生警報時處理流程',
  steps: [
    { t: '心電圖發生警報或出現異常心律' },
    { t: '評估病人意識是否清醒', yes: '是 → 直接確認導線', no: '否 → 確認有無脈搏；無脈搏 → 通報醫師啟動急救流程，有脈搏 → 確認導線' },
    { t: '確認心電圖導線是否鬆脫', yes: '是 → 接好鬆脫導線接頭' },
    { t: '確認心電圖貼片是否脫落或位置錯誤', yes: '是 → 貼上正確貼片位置' },
    { t: '測量生命徵象' },
    { t: '通報醫師評估處理' },
  ],
};

// how a call to the doctor goes (SBAR), shown after a win
export const SBAR_KEYS = [['S', '情境'], ['B', '背景'], ['A', '評估'], ['R', '建議']];

const NOT_STABLE = '這個生命徵象有穩定嗎? 真的不用通報醫師嗎?';
const SENIOR_NO = '學姊衝進病房，說：「我是這樣教你的嗎?」';
const SENIOR_CRY = '學姊跪地哭泣：「你可以去找韻人學姊報到了」';
const BELL_IGNORE = '監視器警報響起，第一時間就是要前往探視病人！';
const STAY = '此時不應該離開病人，應該要先測量血壓，並請家屬或是使用呼叫鈴請求同仁支援。';

// rooms 2-5 share a shape: check the patient first, read the strip, measure, call the doctor
function assess({ conscious, rhythm, wrong, wrongAgain, fixText, goodText, hint, goodWrong, vitals, winText, leaveText, crySay }) {
  return {
    arrive: { t: '前往病房，機器一直在響，該做些甚麼呢?', opts: [{ t: '先看看機器怎麼了', cost: 1, to: 'machine' }, { t: '先看看病人意識狀況', to: 'conscious' }] },
    machine: { t: '要先確認病人有無意識及脈搏喔！', next: 'conscious' },
    conscious: { t: conscious, monitor: true, next: 'rhythm' },
    rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: rhythm, to: 'good' }, { t: wrong, cost: 1, to: 'again' }] },
    again: { t: '要不要再看一次心電圖?', monitor: true, next: 'again2' },
    again2: { t: wrongAgain, opts: [{ t: '是', cost: 1, to: 'cry' }, { t: `不是! 這是${rhythm}`, to: 'fix' }] },
    fix: { t: fixText, next: 'good' },
    cry: { senior: 'cry', t: crySay || SENIOR_CRY, end: 'you' },
    good: { t: goodText, opts: [{ t: '測量生命徵象', to: 'vitals' }, goodWrong] },
    ...(hint ? { hint: { t: hint, next: 'vitals' } } : {}),
    ...(hint ? {} : { senior: { senior: 'stern', t: SENIOR_NO, end: 'you' } }),
    vitals: { t: `血壓 ${vitals.bp} mmHg、心跳 ${vitals.hr} bpm，接下來我該做甚麼呢?`, vitals, opts: [{ t: '告知醫師病人狀況', to: 'win' }, { t: '病人看起來還好，再觀察看看好了，走出病房', cost: 1, to: 'leave' }] },
    leave: { end: 'fail', t: leaveText || NOT_STABLE },
    win: { end: 'win', t: winText },
  };
}

// rooms 6-9: the alarm rings, the nurse decides whether to go
const bellGo = { t: '趕快過去病房看病人狀況', say: '你抓起手電筒和聽診器，快步走向病房。' };
const bellSkip = text => ({ t: text, cost: 1, say: BELL_IGNORE });

export const LEVELS = [
  // ---------- 1 · sinus rhythm · the first level: learn the basic routine ----------
  {
    n: 1, bed: '02A', name: 'Sinus rhythm（竇性心律）', focus: '初階，學會基本流程', patient: 'sit', ecg0: 'leadoff',
    bell: {
      who: '呼叫鈴', text: '噹!噹!噹!\n機器一直在響，該做些甚麼呢?',
      options: [
        { t: '前往病房看機器，並大喊「我正在處理中!」', say: '你大喊：「我正在處理中!」衝向病房。' },
        { t: '不是我的病人喔~ (走出病房)', say: '回到護理站，學姊說：「機器在響，你沒聽到嗎? 去看你病人怎麼了!」你只好回頭，大喊「我正在處理中!」衝向病房。' },
      ],
    },
    start: 'enter',
    nodes: {
      enter: { t: ['進到病房，病人坐在病床上滑手機中。', '請點擊監視器看看病人發生甚麼事情吧!'], ecg: 'leadoff', monitor: true, next: 'what' },
      what: { t: '我該做甚麼?', opts: [{ t: '一條線! 大喊「學姊~~~~」', cost: 1, to: 'shout' }, { t: '檢查心電圖貼片或導線是否脫落', to: 'patch' }] },
      shout: { senior: 'stern', t: [SENIOR_NO, '當病人意識清醒，應該要檢查心電圖貼片或導線是否脫落。'], next: 'patch' },
      patch: { t: '哎呀! 貼片掉了。(重新黏貼心電圖貼片)', ecg: 'sinus', hr: 76, monitor: true, next: 'rhythm' },
      rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: 'sinus rhythm', to: 'win' }, { t: 'Af', cost: 1, to: 'again' }] },
      again: { t: '怎麼會是Af呢? 要不要再看一次心電圖?', monitor: true, next: 'again2' },
      again2: { t: '你還是覺得這是Af嗎?', opts: [{ t: '是', cost: 1, to: 'cry' }, { t: '不是! 這是 sinus rhythm', to: 'win' }] },
      cry: { senior: 'cry', t: SENIOR_CRY, end: 'you' },
      win: { end: 'win', t: '沒錯! 沒錯! 這就是常見的 sinus rhythm。' },
    },
    card: { title: '一條線，先不要慌', points: [
      '監視器出現一條線，病人卻意識清醒、還在滑手機，先想到導線鬆脫或貼片脫落，不是心跳停止。',
      '先看病人，再看機器：確認意識、導線、貼片，再判讀心律。',
      '竇性心律：每個 QRS 前面都有一個 P 波，節律規則，每分鐘 60–100 下。',
    ] },
    sbar: null,
  },

  // ---------- 2 · atrial flutter ----------
  {
    n: 2, bed: '01B', name: 'Atrial flutter（心房撲動）', focus: '心房撲動，評估後通報', patient: 'lie', ecg0: 'flutter', hr0: 124,
    bell: { who: '家屬', text: '一位男性到護理站：「護理師，我爸好像怪怪的」', go: '護理師：「好的，我現在過去!」' },
    start: 'arrive',
    nodes: assess({
      conscious: ['護理師「先生！先生！你還好嗎？」', '病人「護理師，我覺得心跳跳很快，很喘，很不舒服」', '請點擊監視器看看病人發生甚麼事情吧!'],
      rhythm: '心房撲動 Atrial Flutter', wrong: '心房顫動 Atrial fibrillation',
      wrongAgain: '你還是覺得這是心房顫動 Atrial fibrillation 嗎?',
      fixText: '沒錯! 沒錯! P波呈現鋸齒狀，它是心房撲動 Atrial Flutter。',
      goodText: '是心房撲動 (Atrial Flutter)！我該做甚麼?',
      goodWrong: { t: '告訴病人「你先休息，等下還是不舒服再告訴我」', cost: 1, to: 'senior' },
      vitals: { bp: '108/42', hr: 124 },
      winText: '很棒喔! 你有發現病人的不對勁，做出相對應的評估後通報醫師，幫助病人順利通過此次難關~',
    }),
    card: { title: '心房撲動', points: [
      '心房撲動：基線呈鋸齒狀（F 波），心房率約每分鐘 300 下，心室常常每 2 到 3 個波才跟一下，所以 QRS 很規則或規則不規則。',
      '和心房顫動的差別：心房顫動沒有明顯 P 波、R-R 間隔完全不規則；心房撲動看得到鋸齒。',
      '病人心悸、喘、不舒服，心跳又快：先確認意識和脈搏，量生命徵象，再通報醫師。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，01B 先生突然心悸、喘，監視器警報。', B: '先生有心房撲動的相關病史（請依病歷說明），意識清醒。', A: '心電圖是心房撲動，鋸齒狀 P 波；血壓 108/42、心跳 124。', R: '請您過來評估，需要做 12 導程心電圖或給藥嗎？' },
  },

  // ---------- 3 · atrial fibrillation ----------
  {
    n: 3, bed: '03A', name: 'Atrial fibrillation（心房顫動）', focus: '心房顫動，心跳 155', patient: 'lie', ecg0: 'af', hr0: 155,
    bell: { who: '家屬', text: '一位男性到護理站：「護理師! 機器一直叫!」', go: '護理師：「好的，我現在過去!」' },
    start: 'arrive',
    nodes: assess({
      conscious: ['護理師「先生！先生！你還好嗎？」', '病人「心臟跳好大力，我感覺快要喘不過氣了」', '請點擊監視器看看病人發生甚麼事情吧!'],
      rhythm: 'Atrial fibrillation', wrong: 'sinus tachycardia',
      wrongAgain: '你還是覺得這是 sinus tachycardia 嗎?',
      fixText: '沒錯! 沒錯! P波細小、數量多，不易辨認，它是 Atrial fibrillation。',
      goodText: '是 Af！心電圖顯示心跳 155 bpm，我該做甚麼?',
      goodWrong: { t: '應該還好吧! 學姊交班說今天心跳 140 bpm，醫師說有加藥，觀察就好', cost: 1, to: 'senior' },
      vitals: { bp: '90/51', hr: 155 },
      winText: '耶~太棒了! 你有發現病人的不對勁，做出相對應的評估後通報醫師，幫助病人順利通過此次難關~',
    }),
    card: { title: '心房顫動', points: [
      '心房顫動：沒有明顯的 P 波，基線細細顫動，R-R 間隔「完全不規則」。',
      '心室速率很快時（這裡 155 下），血壓可能掉下來，病人會心悸、喘。',
      '交班說「今天心跳 140，醫師有加藥」，不代表現在可以不管：心跳更快、血壓更低，就是變化，要通報。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，03A 先生心跳很快、喘不過氣。', B: '先生有心房顫動，白班交班心跳約 140、已加藥。', A: '心電圖是心房顫動，心跳 155、血壓 90/51，比白天更差。', R: '請您過來評估，需要調整藥物或其他處置嗎？' },
  },

  // ---------- 4 · first-degree AV block ----------
  {
    n: 4, bed: '01D', name: '1° AV block（第一度房室傳導阻滯）', focus: '1度 AV block，有症狀', patient: 'lie', ecg0: 'avb1', hr0: 51,
    bell: { who: '家屬', text: '一位男性到護理站：「我媽媽很不舒服，機器也一直叫，可以去看他一下嗎?」', go: '護理師：「好的，我現在過去!」' },
    start: 'arrive',
    nodes: assess({
      conscious: ['護理師「小姐！小姐！你還好嗎？」', '病人「我頭好暈，全身無力」', '請點擊監視器看看病人發生甚麼事情吧!'],
      rhythm: '1度 AV block', wrong: 'junctional rhythm',
      wrongAgain: '你覺得這是?',
      fixText: '沒錯! 沒錯! 它有P波且PR間隔大於0.2秒，是 1度 AV block。',
      goodText: '是 1度 AV block！我該做甚麼?',
      goodWrong: { t: '1度 AV block 應該還好吧!', cost: 1, to: 'hint' },
      hint: '但是病人有頭暈症狀耶，我們幫他量個血壓如何?',
      vitals: { bp: '101/43', hr: 51 },
      winText: '太棒了! 你有發現病人的不對勁，做出相對應的評估後通報醫師，幫助病人順利通過此次難關~',
      leaveText: '病人有頭暈症狀，且心跳變慢，真的不用通報醫師嗎?',
      crySay: '學姊跪地哭泣：「它有P波阿~~~」',
    }),
    card: { title: '第一度房室傳導阻滯', points: [
      '每個 P 波後面都跟著一個 QRS（所以不是交界性心律），但 PR 間隔拉長，大於 0.20 秒。',
      '1 度 AV block 本身常常不嚴重；但病人有頭暈、無力，心跳又慢到 51 下，就要量生命徵象並通報。',
      '看的不只是心電圖，還有病人有沒有症狀。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，01D 女士頭暈、全身無力，監視器警報。', B: '女士意識清醒，（請依病歷說明病史與用藥）。', A: '心電圖是第一度房室傳導阻滯，PR 大於 0.2 秒；血壓 101/43、心跳 51，有頭暈症狀。', R: '請您過來評估，需要檢查藥物或做 12 導程心電圖嗎？' },
  },

  // ---------- 5 · third-degree AV block ----------
  {
    n: 5, bed: '04A', name: '3° AV block（第三度房室傳導阻滯）', focus: '3度 AV block，心跳 25', patient: 'lie', ecg0: 'avb3', hr0: 25,
    bell: { who: '家屬', text: '一位男性到護理站大喊：「機器很吵ㄟ!!!」', go: '護理師：「我現在過去看」' },
    start: 'arrive',
    nodes: assess({
      conscious: ['護理師「先生！先生！你還好嗎？」', '病人「我全身都感覺不舒服」', '請點擊監視器看看病人發生甚麼事情吧!'],
      rhythm: '3度 AV block', wrong: 'sinus bradycardia',
      wrongAgain: '你覺得這是?',
      fixText: '雖然QRS波規則出現，但是! P波與QRS波各跳各的，所以它是 3度 AV block。',
      goodText: '是 3度 AV block！心跳顯示 25 bpm！我該做甚麼?',
      goodWrong: { t: '3度 AV block? 大叫學姊!!! 他的心跳好低喔!!!', cost: 1, to: 'hint' },
      hint: '但是病人有頭暈症狀耶，我們幫他量個血壓如何?',
      vitals: { bp: '98/32', hr: 25 },
      winText: '真厲害! 你有發現病人的不對勁，做出相對應的評估後通報醫師，幫助病人順利通過此次難關~',
      leaveText: '3度 AV block 屬於高風險心搏過緩，真的不用通報醫師嗎?',
      crySay: '學姊跪地哭泣：「P波與QRS波各跳各的，它是 3度 AV block 阿~~~」',
    }),
    card: { title: '第三度（完全）房室傳導阻滯', points: [
      'P 波規則地跳，QRS 也規則地跳，但兩者互不相干（房室分離），心室率很慢，這裡只有 25 下。',
      '它是高風險的心搏過緩，可能需要暫時性或永久節律器，一定要通報醫師。',
      '大叫學姊不能代替評估：先量血壓、生命徵象，再用 SBAR 把話說清楚。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，04A 先生全身不舒服，心跳只有 25 下。', B: '先生意識清醒，（請依病歷說明病史與用藥）。', A: '心電圖是第三度房室傳導阻滯，P 波與 QRS 波各自跳；血壓 98/32、心跳 25。', R: '請您立刻過來評估，是否需要準備暫時性節律器？' },
  },

  // ---------- 6 · pulse VT ----------
  {
    n: 6, bed: '03B', name: 'Pulse VT（有脈搏的心室頻脈）', focus: 'VT 有脈搏，不能離開病人', patient: 'lie', ecg0: 'vt', hr0: 164,
    bell: { who: '呼叫鈴', text: '噹!噹!噹!\n機器一直在響，該做些甚麼呢?', options: [bellSkip('病人下床上廁所，短暫拆掉導線而已，不用過去看啦!'), bellGo] },
    start: 'conscious',
    nodes: {
      conscious: { t: ['護理師「先生！先生！你還好嗎？」', '病人呼吸喘，雙手摀住胸口', '請點擊監視器看看病人發生甚麼事情吧!'], monitor: true, next: 'rhythm' },
      rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: 'VT', to: 'good' }, { t: 'VF', cost: 1, to: 'again' }] },
      again: { t: '要不要再看一次心電圖?', monitor: true, next: 'again2' },
      again2: { t: '你覺得這是?', opts: [{ t: '就是 VF', cost: 1, to: 'cry' }, { t: '不是! 這是 VT', to: 'fix' }] },
      cry: { senior: 'cry', t: '學姊跪地哭泣：「VF不會有脈搏阿~~~」', end: 'dead' },
      fix: { t: '寬的QRS波，而且看不見P波，它就是VT！分為有脈搏和無脈搏的，看見VT記得摸看看病人有無脈動喔！', next: 'good' },
      good: { t: '是VT！觸診頸動脈有脈動，我現在要做甚麼?', opts: [{ t: '測量生命徵象', to: 'vitals' }, { t: 'VT? 趕快出去叫學姊', cost: 1, to: 'hint' }] },
      hint: { t: 'VT是致命性心律不整，此時不應該離開病人，應該要先測量血壓，並請家屬或是使用呼叫鈴請求同仁支援。', next: 'vitals' },
      vitals: { t: '血壓 80/31 mmHg、心跳 164 bpm，接下來我該做甚麼呢?', vitals: { bp: '80/31', hr: 164 }, opts: [{ t: '告知醫師病人狀況', to: 'win' }, { t: '血壓好低喔，讓病人採頭低腳高臥姿，等下再來量血壓', cost: 1, to: 'dead' }] },
      dead: { end: 'dead', t: '血壓這麼低、心跳 164 下，每一分鐘都很重要。這時候該做的是通報醫師，不是等下再量。' },
      win: { end: 'win', t: '你太棒了! 冷靜的面對VT，並做出相對應的評估後通報醫師，幫助病人順利通過此次難關~' },
    },
    card: { title: '有脈搏的心室頻脈（Pulse VT）', points: [
      'VT：QRS 寬、快、規則，看不到 P 波。看到 VT，第一件事是摸頸動脈：有沒有脈搏？',
      '有脈搏但血壓低、喘、胸悶：病人不穩定，要立刻通報醫師（醫師可能決定同步電擊）。不要離開病人，用呼叫鈴請同仁支援。',
      'VF 沒有脈搏，也沒有規則的波形；VT 的波形是規則的寬 QRS。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，03B 先生突然喘、胸悶，監視器顯示 VT。', B: '先生意識清醒，（請依病歷說明病史）。', A: '心電圖是心室頻脈，頸動脈摸得到脈搏；血壓 80/31、心跳 164。', R: '請您立刻過來評估，我先準備急救車和去顫器。' },
  },

  // ---------- 7 · PSVT ----------
  {
    n: 7, bed: '04B', name: 'PSVT（陣發性上心室頻脈）', focus: 'PSVT，心跳 170', patient: 'lie', ecg0: 'psvt', hr0: 170,
    bell: { who: '呼叫鈴', text: '呼叫鈴響起，接起電話只聽到警報鈴', options: [bellSkip('病人又誤觸呼叫鈴了，不用過去看'), bellGo] },
    start: 'conscious',
    nodes: {
      conscious: { t: ['護理師「先生！先生！你還好嗎？」', '病人呼吸喘，冒冷汗「感覺我現在心跳好快」', '請點擊監視器看看病人發生甚麼事情吧!'], monitor: true, next: 'rhythm' },
      rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: 'PSVT', to: 'good' }, { t: 'sinus tachycardia', cost: 1, to: 'again' }] },
      again: { t: '要不要再看一次心電圖?', monitor: true, next: 'again2' },
      again2: { t: '你覺得這是?', opts: [{ t: '就是 sinus tachycardia', cost: 1, to: 'fix' }, { t: '這是 PSVT', to: 'fix' }] },
      fix: { t: '窄且規律的QRS波，無明顯P波，它就是PSVT！', next: 'good' },
      good: { t: '是PSVT！我現在要做甚麼?', opts: [{ t: '測量生命徵象', to: 'vitals' }, { t: '趕快出去叫學姊', cost: 1, to: 'hint' }] },
      hint: { t: STAY, next: 'vitals' },
      vitals: { t: '血壓 90/42 mmHg、心跳 170 bpm，接下來我該做甚麼呢?', vitals: { bp: '90/42', hr: 170 }, opts: [{ t: '告知醫師病人狀況', to: 'win' }, { t: '收縮壓有 90 mmHg 應該還好，請病人臥床休息，等下再來量血壓', cost: 1, to: 'dead' }] },
      dead: { end: 'dead', t: '心跳 170 下、冒冷汗、血壓偏低：這樣的病人不能只是休息，要立刻通報醫師。' },
      win: { end: 'win', t: ['哇賽~你真是太棒了! 經過你的選擇，幫助病人順利通過此次難關~', '記得PSVT打Adenosine時要快速IVP喔~劑量是6mg-12mg-12mg。'] },
    },
    card: { title: '陣發性上心室頻脈（PSVT）', points: [
      'PSVT：QRS 窄、非常規律、每分鐘 150–220 下，看不到明顯的 P 波。',
      '竇性心搏過速是慢慢加快、慢慢變慢，且 P 波看得到；PSVT 常常是突然開始、突然停止。',
      '先量生命徵象、通報醫師，不離開病人。醫師可能先做刺激迷走神經的方法，必要時依醫囑給 Adenosine：快速靜脈推注，6 mg、12 mg、12 mg。',
    ] },
    sbar: { S: '值班醫師您好，我是內科病房護理師，04B 先生突然心悸、冒冷汗，心跳 170 下。', B: '先生意識清醒，（請依病歷說明病史）。', A: '心電圖是窄 QRS、規律的快速心律，看不到 P 波，像 PSVT；血壓 90/42。', R: '請您過來評估，需要準備 Adenosine 嗎？' },
  },

  // ---------- 8 · pulseless VT · boss: review the resuscitation steps ----------
  {
    n: 8, bed: '05A', name: 'Pulseless VT（無脈搏的心室頻脈）', focus: '魔王關卡，複習急救流程', patient: 'lie', ecg0: 'vt', hr0: 190, boss: true,
    bell: { who: '呼叫鈴', text: '噹!噹!噹!\n監視器警報鈴持續響起', options: [bellSkip('病人又再亂動了，不用理會，等下就會停了'), bellGo] },
    start: 'noresp',
    nodes: {
      noresp: { t: ['護理師「先生！先生！你還好嗎？」', '叫喚病人無反應，接下來我該做甚麼?'], opts: [{ t: '沒事啦，他在睡覺而已', to: 'dead' }, { t: '觸診頸動脈', to: 'pulse' }] },
      dead: { end: 'dead', t: '叫不醒、沒有反應，絕對不是在睡覺。要馬上確認有沒有脈搏。' },
      pulse: { t: '觸診頸動脈無脈動，心電圖貼片及導線位置正確，請點擊監視器看病人現在的心律為何?', monitor: true, next: 'rhythm' },
      rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: 'VT', to: 'good' }, { t: 'PEA', cost: 1, to: 'again' }] },
      again: { t: '要不要再看一次心電圖?', monitor: true, next: 'again2' },
      again2: { t: '你覺得這是?', opts: [{ t: '就是 PEA', cost: 1, to: 'fix' }, { t: '這是 VT', to: 'fix' }] },
      fix: { t: '寬的QRS波，而且看不見P波，它是VT！', next: 'good' },
      good: { t: '是無脈搏 VT！我現在要做甚麼?', opts: [{ t: '開始CPR，並大聲呼叫急救，讓其他同仁前來支援', to: 'cpr' }, { t: '趕快出去推急救車', cost: 1, to: 'leave' }] },
      leave: { end: 'fail', t: '此時不應該離開病人，應該要先開始CPR，並請求同仁支援。' },
      cpr: { cpr: true, t: '開始胸外按壓！照著節拍壓，每分鐘 100–120 下。', next: 'win' },
      win: { end: 'win', t: '因為你冷靜且正確的做出選擇，救活一條人命~' },
    },
    card: { title: '無脈搏的 VT：馬上 CPR', points: [
      '叫喚沒有反應、頸動脈摸不到脈搏，監視器是 VT：就是心跳停止，要立刻 CPR，並大聲呼叫急救、請同仁推急救車和去顫器來。',
      '不要離開病人去推車：一個人離開，就少了一個人壓胸。',
      '按壓：每分鐘 100–120 下，深度 5–6 公分，讓胸口完全回彈，盡量不中斷。去顫器一到，依指示盡快電擊。',
    ] },
    sbar: { S: '（呼叫急救）05 病房 05A 無意識、無脈搏，心電圖是無脈搏 VT，開始 CPR！', B: '先生本來意識清醒，（請依病歷說明病史）。', A: '叫喚無反應、頸動脈無脈搏，貼片導線位置正確。', R: '請急救小組帶去顫器過來，我先壓胸。' },
  },

  // ---------- 9 · PEA · boss ----------
  {
    n: 9, bed: '05B', name: 'PEA（無脈搏電氣活動）', focus: '魔王關卡，複習急救流程', patient: 'lie', ecg0: 'pea', hr0: 58, boss: true,
    bell: { who: '呼叫鈴', text: '逼----------\nDC shock警報鈴響起', options: [bellSkip('病人下床上廁所，短暫拆掉導線而已，不用過去看啦!'), bellGo] },
    start: 'noresp',
    nodes: {
      noresp: { t: ['護理師「先生！先生！你還好嗎？」', '叫喚病人無反應，接下來我該做甚麼?'], opts: [{ t: '沒事啦，他在睡覺而已', to: 'dead' }, { t: '觸診頸動脈', to: 'pulse' }] },
      dead: { end: 'dead', t: '叫不醒、沒有反應，絕對不是在睡覺。要馬上確認有沒有脈搏。' },
      pulse: { t: '觸診頸動脈無脈動，心電圖貼片及導線位置正確，請點擊監視器看病人現在的心律為何?', monitor: true, next: 'rhythm' },
      rhythm: { t: '這是甚麼心律呢?', quiz: 'read', opts: [{ t: 'PEA', to: 'good' }, { t: 'sinus rhythm', cost: 1, to: 'fix' }] },
      fix: { t: '觸診頸動脈無脈動，所以它是無脈搏電氣活動 PEA。', next: 'good' },
      good: { t: '病人沒有心跳了，我現在要做甚麼?', opts: [{ t: '開始CPR，並大聲呼叫急救，讓其他同仁前來支援', to: 'cpr' }, { t: '趕快出去推急救車', cost: 1, to: 'leave' }] },
      leave: { end: 'fail', t: '此時不應該離開病人，應該要先開始CPR，並請求同仁支援。' },
      cpr: { cpr: true, t: '開始胸外按壓！照著節拍壓，每分鐘 100–120 下。', next: 'win' },
      win: { end: 'win', t: '因為你冷靜且正確的做出選擇，救活一條人命~' },
    },
    card: { title: 'PEA：看得到波形，摸不到脈搏', points: [
      'PEA（無脈搏電氣活動）：監視器上有組織的心律，看起來像正常，但摸不到頸動脈，病人沒有意識。',
      '看到波形不代表有心跳：處置一定要先摸脈搏。',
      '立刻 CPR、大聲呼叫急救；急救小組會依流程每 2 分鐘重新評估節律，並尋找可逆的原因。PEA 不是去顫器電擊的節律。',
    ] },
    sbar: { S: '（呼叫急救）05 病房 05B 無意識、無脈搏，監視器有波形，是 PEA，開始 CPR！', B: '先生本來意識清醒，（請依病歷說明病史）。', A: '叫喚無反應、頸動脈無脈搏，貼片導線位置正確。', R: '請急救小組過來，我先壓胸，請同仁準備急救藥物。' },
  },
];

// the beds with no call tonight: the ward still has patients in them
export const QUIET_BEDS = ['01A', '01C', '02B'];

// chest compressions to the beat (levels 8 and 9)
export const CPR = { presses: 30, slowest: 100, fastest: 120, maxGap: 2.5 };
