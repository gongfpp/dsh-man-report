# 开发与验证

```sh
npm install --ignore-scripts
npm test
npm pack --dry-run
```

## 当前架构：仅离线素材播放

0.5.0 移除了 0.4.0 的在线合成、凭据设置、每日额度、缓存服务和 `man031_voice_prepare` 工具。最终用户不提供 Key；运行包不含语音云服务调用代码。开发时的生成脚本、调用台账与原始文件只保存在不发布的 scripts/dev 中。

0.9.0 起音库按情绪分四档：同一音色（`S_PneVZcKf2`）用四条不同表演指令分别重录全部 65 段台词（数字 0–19、整十数、point、hundred/thousand/million/billion、9 段开头、17 段结尾、5 个货币单位、`token-used`），共 260 段无损 WAV，合计约 18.7MB。`manifest.tierBands` 定义分档边界（金额 .02/.1/1，Token 1000/10000/100000），`manifest.tierOverrides` 保存 t1/t3/t4 每段台词的文件、SHA-256 与时长；t2 是 `manifest.clips` 里的默认集。`client.js` 的 `voiceTier(manifest, amount, mode)` 与 `clipFor(manifest, key, tier)` 决定整句使用哪一档，所以同一句里的前缀、数字和结尾永远来自同一档。

0.9.0 起常用金额改用整句：`manifest.wholeSamples['CNY:<金额>'][<句子ID>] = { file, sha256, duration, phraseId, fullUtterance: true }`，共 10 个金额（0.01/0.02/0.03/0.05/0.08/0.10/0.20/0.30/0.50/1.00）× 20 句 = 200 条连续整句录音（MP3 96kbps 单声道 24kHz）。`client.js` 的 `getAudioPlan` 先查整句，命中就整句播放、不再拼接；未覆盖的金额与美元继续用四档片段组合。整句由 `build-whole-samples.mjs` 生成（外围静音裁切 + 50ms 余量、单条静态增益到活动帧 RMS -24.8dB、true-peak -2.2dB，不拼接、不变调、不变速），素材与报告在 `dev/voice-bank-v4/`。金额显示与字幕同时改为两位小数向上取整（BigInt 进位），语音分词用同一结果。

历史音库：0.5.0 的 68 份预制 WAV（0.6.0 新增 18 份、0.7.0 再新增 10 份、0.8.0 新增 3 份 Token 片段）包含台词前缀、数字、整十数、point、hundred/thousand/million/billion，以及人民币/美元单位与结尾；其中 65 份被 0.9.0 的 MP3 替换，`yuan.wav`、`dollars.wav`、`singular-dollar.wav` 仅作未使用的历史资源保留。manifest 显式声明资源，宿主只提供这些文件，不开放目录。数字内容经本地缓存识别模型校验；这不能代替主观音质验收。每份新片段的人工听审字段保留 false，不把用户认可的整句或单档扩大成全部素材已听审。

0.9.0 之后数字片段改由“整段数字朗读”切分：每档让同一音色一口气念完 33 个数字（`Zero. One. … Ninety. Point. Hundred. Thousand. Million. Billion.`），再按真实停顿切开，所以同一句里的数字共享同一段语调与气口。切分脚本 `split-recital.py`（能量门限 -50dB、110ms 合并、50ms 余量）用本地缓存的识别模型做词序对齐，只保留词序匹配的切点，不校验发音、不代替听审；合并切分与气口位置记在 `dev/voice-bank-v3/clips/<tier>/report.json`。`build-voice-bank-v3.mjs` 把四档各 33 段换进音库（前缀、单位、结尾仍用 0.9.0 的独立录制），manifest 增加 `voiceBank.layout: 'recital-numbers'` 与每段的 `source: recital-<tier>`，其余字段结构不变。语音节奏对比脚本 `render-recital-vs-whole.mjs` 用真实 `getAudioPlan` 渲染 A（整句样张）/B（旧独立片段拼接）/C（整段朗读切分）三条。

0.9.0 的构建脚本：`build-voice-bank-v2.mjs`（解码、切段、统一活动帧 RMS 约 -24.8dB、true-peak 上限 -2.2dB、输出 WAV PCM16 单声道 24kHz（无损，不再二次有损压缩）并写 manifest 与 `dev/voice-bank-v2/build-report.json`）。人民币单位在中文语境句“人民币。元。”中取第二个词，避免单字“元”在孤立合成时被读坏；四档各自取一次。原始 UI 生成结果在 `dev/voice-bank-v2/raw/<tier>/`，台词与档位指令在 `dev/voice-bank-v2/tiers.json`，试听样张在 `dev/voice-bank-v2/audition/`。生成全部通过豆包体验页的免费复刻额度完成，不激活付费音色、不调用公开合成 API。

生成脚本：`generate-doubao-offline.mjs`。渲染脚本：`render-doubao-offline-pilot.mjs`。发布脚本：`publish-doubao-offline.mjs`。所有调用仅发生在开发阶段，使用现有音色；不新建音色、不调用付费云识别。单词各自完整合成，不在词中切割；只修剪外围低能量静音并保留 50ms 余量，静态增益统一活动帧 RMS 约 -24.8dB，true-peak 上限 -2.2dB，不变速或变调。

用户确认的 0.31 元整句保持原样：SHA-256 `616c0da0c19a87c82f8531cc8ee2aea1da87c2eb24c9506b72dfed44d9f4c1a2`。资源仍原样保留，但只有句子 ID 匹配时才能使用，不能替代二十句中的另一句。0.6.0 按用户新要求，将显示及数字分词统一为三位小数四舍五入：从完整十进制文本提取千分位与下一位，用 BigInt 进位，避免浮点乘法边界错误；原费用记录不变。支持 0 至小于 1e12 的费用，较小正数按相同规则显示为 0.000。自动提醒随机一次、重试固定本次句子；试听可显式选二十句之一。0.7.0 的新增文案计划在 generate-doubao-phrases-v3.mjs，复用原55份资源，只另生成10份固定片段；发布命令为 `node scripts/publish-doubao-phrases.mjs --v3`。新素材生成与发布脚本为 generate-doubao-phrases.mjs / publish-doubao-phrases.mjs；本地识别报告、真实界面选句及 0.000749→0.001 播放证据位于 dev/doubao-phrases-v2。

## 原生插件设置

0.5.6 将全部设置放在 `plugins.bundle.config`，以包名 `dsh-man-031` 为 key，仅在 `view: 'page'` 渲染；路径是左侧「插件 → Man！花了这么多钱！」详情页。旧 `settings.plugins.tab` 注册已移除，不再放在「内置插件」中。原 `man-031.preferences.v2` 偏好键不变，设置与提醒通过同一订阅状态同步，试听沿用现有音频控制器。试听图片使用浏览器原生 top-layer popover；正常轮次提醒的呈现方式不变。

## 费用与生命周期

投影 `man031Completion` 使用 stateVersion 3，配对 turn/start 与 completed turn/end，增量收集 request/header、request/context、assistant/message 和 compaction/summary 的请求模型与原生用量。服务端每轮最多 2048 条、保留最近 8 轮，wire 仍只传边界；客户端不重新扫描历史。authenticated GET `/api/man-031/cost` 校验主会话本轮边界，再优先调用 costMeter 的 getTurnCost(sessionId,startSeq,endSeq,currency)。

只采信 apiCost 与完整定价覆盖；cost 中的套餐等价值不视作额外扣费。服务缺失、异常、超时或结果不完整时，用 lib/public-pricing.js 按每个请求分别估算；缺失用量或单价仍返回 unknown。公开数据只做固定 URL、有大小限制和超时的后台更新，每实例最多每天一次；始终先用随包快照，不阻塞提醒。带日期的汇率不是声称实时账单。未知不当作零，不混入无法归属的子任务。

`?mode=tokens` 直接返回本轮原生总量，不查费用服务或价格。输入、输出、缓存读写分别相加，推理已在输出中，不重复加。reportMode 沿用原浏览器偏好键，默认 money、可选 tokens；Token 模式四套固定句式、整数试听、本地数字与 token/tokens 单位同步切换。

客户端使用真实 React StrictMode 测试首轮、历史、绑定就绪、费用重试、跨窗口去重、取消与资源回收。关闭、切走、切换会话后不迟到播放。模拟时间轴和本地识别不能替代真实浏览器试听或实际轮次结束的验收；应分别记录验证结果。

## 0.5.0 实际轮次检查（2026-11-09）

已安装的离线版本在真实 completed 事件 endSeq=5713 后查询到主会话估算费用 `0.0007494791120171481 CNY`，实际弹图字幕保留了这一完整金额。浏览器记录的本插件 23 个 AudioBuffer 时长逐一匹配当前 manifest 对应的本地 WAV，调度时间首尾连续，没有拿相近金额替代。在线 `/voice/status` 返回 404；真实美元试听也只请求本插件的本地资源。临时观测已清理，设置恢复人民币。

同一全局音频观测还捕获了另一个 AudioContext 的 6 个声源，未单独归因，不能当成本插件额外播放次数或主观音质通过的证据。新拼接素材仍保留未人工听审标记。设置截图已重新从安装后的离线界面采集，不再包含已撤销的连接按钮。

## 小米 100 条候选集

`generate-mimo-100.mjs` 仅用于开发，按用户选择为 0.01–1.00 元各生成一条完整句，统一参考已认可的豆包 AI 成品。使用普通 MiMo TTS，不用收费 Batch 和云端 ASR。原计划 100 次调用；第 8 次 HTTP 200 但响应失败、未收到本地音频，保留失败台账并明确补生成一次，总尝试上限改为 101，已成功的 7 条不会重跑；输出、调用台账及勾选试听页位于被忽略的 dev 目录。整句仅调节音量，不拼贴、变速或改调。候选不自动写入运行 manifest，须由用户挑选。

## 更新与发布

使用官方插件管理器更新，不手改 profile。以安装结果和真实接口确认宿主生效，刷新页面确认客户端。包内容仅保留运行资源、必要文档、图标和少量真实截图；不包含 dev、生成脚本、凭据、原始参考、旧运行时或旧 MiMo 音频。未获素材公开分发许可前保持 private，不自动推送 GitHub。
