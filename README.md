[README.md](https://github.com/user-attachments/files/34462556/README.md)
# 注意力实验室 · 三个注意实验（可交互网站）

项目码：**HV5WV3**　｜　页面顺序：**SEEV → 低流行率 → 姿态仪**　｜　被试：**10 人**

一个纯前端（HTML + CSS + JS）的多实验站点。三个实验各自复现一个注意/人因领域的经典效应，并各自带一个**改进想法**；其中**实验二（低流行率搜索）和三的改进条件是新增条件，真正收数据**。

> ⚠️ **本 README 中的预测写于收集任何数据之前。** 分析计划（尤其是主推断改用方向性符号检验）也在收数据前定稿，见第 5 节。



---


## 1. 站点结构与运行方式

```
index.html              知情同意 + 被试编号 + 进度/导出首页 + 结果页入口
exp1-seev.html          实验一：SEEV 驾驶仪表采样（价值操控）
exp2-prevalence.html    实验二：低流行率视觉搜索（TIP 2×2 ← 收数据的新条件）
exp3-attitude.html      实验三：姿态仪 inside-out/outside-in + Malcolm Horizon
results.html            结果与分析：全体被试聚合、效应量、与原文对比、8 张模型图
js/common.js            会话、计时（performance.now）、数据提交、SDT、符号检验
js/analysis.js          数据归一化 / 统计 / 效应量 / 文献锚点（纯函数，可在 Node 单测）
js/charts.js            零依赖 canvas 图表（分组柱状、折线、散点、ROC），不引任何 CDN
js/results.js           结果页控制器（数据接入、达标检查、8 张图、对比表、导出）
js/personal.js          三个结束页的「个人结果 + 原理 + 全体结果入口」
js/xray.js              canvas 程序化生成行李 X 光刺激
js/gaze.js              WebGazer 封装 + 校准 + 精度自测 + 自动降级
css/style.css           统一样式
vendor/webgazer/        自托管 WebGazer（GPLv3）与其 MediaPipe FaceMesh 模型
```

**运行**：必须是 **https 或 localhost**（`getUserMedia` 需要安全上下文；直接双击用 `file://` 打开时摄像头不可用，但会自动降级为鼠标方式，实验照常能做完）。直接复制“https://bnu-engpsy-fall26.github.io/GuoYuan202411061049/attention_gy/index.html”在浏览器中打开即可开始实验。

本地预览：

```bash
python -m http.server 8000     # 然后打开 http://localhost:8000
```

**部署**：整站静态，可直接放 GitHub Pages（默认 HTTPS）。


**数据接口**：POST 到注意实验室收集端点 `https://attention-lab-production.up.railway.app/api/hw2/submit`（项目码 `HV5WV3`）。payload 为接口模板要求的 `{ project, experiment, participant, condition, trials: [{cond, rt, correct}, …] }`，每条试次记录在标准键之外附带该实验的完整明细字段；按收集页要求**不上传姓名、学号**（被试只有匿名编号）。接口规则（以 /hw2 页面为准）：单次提交 ≤ 256 KB、≤ 2000 试次、同一网络每分钟 ≤ 30 次；响应在 JSON body 里给 `{ok: true/false, msg}`（HTTP 恒为 200），代码按 body.ok 判定成败，拒绝时提示 msg 并把数据留在本地队列。提交成功即从重试队列出队，避免重复上传。端点写在 `js/common.js` 顶部，如需指向其他地址，在加载该文件**之前**设置 `window.HW_API_BASE` 即可。全体被试匿名数据可经 `GET /api/hw2/data?project=HV5WV3&experiment=<实验名>` 读取（分析脚本用）。  
Payload 形如：

```json
{ "project": "HV5WV3", "experiment": "prevalence", "participant": "P01",
  "startedAt": "...", "finishedAt": "...", "trials": [ ... ], "meta": { ... } }
```

**提交失败不会丢数据**：每份数据都同步写入 localStorage，首页可「重试提交」或「导出 JSON」。

---


## 2. 实验一 · SEEV 驾驶仪表采样 —— 价值（V）项操控

**复现的现象。** Senders (1964)：人按信号的**信息带宽**成比例地分配视觉采样（类比采样定理），注视频率随带宽单调上升。

**模型。** SEEV：Wickens 等 (2003) `P(A) = s·S − ef·EF + ex·EX + v·V`；驾驶版：Horrey, Wickens & Consalus (2006) `P(A) = Σ_tasks [B_t × R_t × P_t] − Ef_t`，其中 B = 带宽、R = 相关性、**P = 任务优先级**、Ef = 努力。

**改进想法（新条件）。** 操控 **P（价值项）**：基线下三个仪表越线均 −10 分；新条件下把**最低带宽的油量表**越线罚分提高到 −50，其余不变。E（期望）与 S（显著性）保持不变。

**做法。** 车道保持（←/→）+ 三个仪表（速度 0.40 Hz / 水温 0.20 Hz / 油量表 0.05 Hz，带宽取 Senders 原始量级）。**凝视跟随窗口**：只有被注视的仪表才清晰，其余雾化——因此必须来回扫视才能发现越线事件。越线后按 1 / 2 / 3 报告。每条件 10 小段 × 20 s（满足每条件 ≥10 试次），条件顺序在被试间平衡。

**注视来源（严格互斥 + 自动降级，2026-11-04 修正）。** 选用摄像头并完成校准后，AOI 清晰化**只由 WebGazer 的注视预测驱动，鼠标完全不参与**；未选用摄像头、或摄像头确实不可用时，才**只由鼠标位置**驱动。两种方式绝不同时写 `Gaze.point`。


实现要点：

- 全屏 **9 点校准**（盯住红点并点击）+ **7 点精度自测**（只看不点，按空格），平均像素误差写入 `meta.gazePrecisionPx`；
- 校准完成后立即调用 `webgazer.removeMouseEventListeners()`。WebGazer 默认把全局 `click` **和** `mousemove` 都当作隐式回归训练样本，若不在校准后移除，实验中被试一移动鼠标就会把预测点拉向鼠标——这是"眼动看起来跟着鼠标"的第二个机制；
- 摄像头已打开但**一次有效注视预测都没有**（未检测到人脸）时判为失败并降级，不拿未训练的假眼动数据充数；
- 降级条件：库未加载 / 不支持 `getUserMedia` / 拒绝授权 / 摄像头被占用 / 校准超时 / 未检测到人脸。降级会关闭摄像头、清理校准覆盖层，并在 HUD、结果页与 `meta.gazeError` 写明原因；`begin()` 失败时"onFail 回调 + Promise reject"会双重触达，已加防重入；
- 摄像头模式下 HUD 实时显示"眼动跟踪正常 / 未检测到注视"，**练习段**画一个淡注视点供被试确认眼动生效，**正式段不画**（让被试看见自己的注视点会形成反馈、改变扫视策略）。

每条数据带 `gaze_source` 字段。摄像头画面**只在本地浏览器处理，不录制、不上传**。

**预测（收数据前定稿）**

1. 基线 PDT 随带宽单调递减：速度 > 水温 > 油量。
2. **油量表 PDT 在价值条件下显著上升**，速度表 PDT 相应下降（注意资源总量有限）。
3. 油量表事件漏报率下降。
4. 代价：车道保持 RMS 略升。
5. 用 Horrey 版公式算预测 PDT，与实测 PDT 作对比图（站点内已实现，实验结束即显示）。

**已知局限。** ① 油量表带宽只有 0.05 Hz，200 s 内仅约 3–4 个事件，其漏报率的分母很小、噪声大；② 本设计把"扣分权重"操作化为 P，这是**我们的操作化**，不是 Horrey 2006 原文的数值；③ 网页屏幕视角有限，无法复现真实驾驶的视角与风险。

---


## 3. 实验二 · 低流行率视觉搜索 —— TIP 2×2

**复现的现象。** Wolfe, Horowitz & Kenner (2005, *Nature*)：目标越罕见，漏得越多。该文实测三档流行率 **1% / 10% / 50% → 漏报 30% / 16% / 7%**。

**机制。** Wolfe 等 (2007)：这是**判定标准 c 偏移，不是敏感度 d′ 下降**；单纯"劝被试放宽标准"均失败。Wolfe & Van Wert (2010)：流行率同时影响逐项目判定标准和**退出阈限**，且 c 随流行率**连续**变化（实验二 r = −0.92）。

**改进想法。** 现实机场用 **TIP**（威胁图像投影）。文献指出 TIP 其实做了两件事：**提高目标流行率** + **提供即时反馈**（Cutler & Paddock, 2009）。幻灯片建议把两者捆在一起，说不清是哪个在起作用。因此拆成 **2×2**：{插入虚拟目标 / 不插入} × {即时反馈 / 无反馈}。

**设计**（被试内，共 146 试次）

| Block             | 试次 | 真实目标 | 插入虚拟目标 | 体验到的流行率 | 反馈    |
| ----------------- | -- | ---- | ------ | ------- | ----- |
| 1 高流行率基线（固定最前）    | 20 | 10   | 0      | 50%     | 有     |
| 2 低流行率控制          | 30 | 5    | 0      | 16.7%   | 无     |
| 3 仅插入             | 33 | 5    | 3      | 24%     | 无     |
| 4 仅反馈             | 30 | 5    | 0      | 16.7%   | **有** |
| 5 完整 TIP（**新条件**） | 33 | 5    | 3      | 24%     | **有** |

Block 1 固定最前，2–5 用 4×4 拉丁方在被试间平衡；目标为**刀**（宽刃水果刀构型，与螺丝刀构成"细杆+粗柄 vs 宽身+窄柄"的轮廓反转），刺激由 canvas 程序化生成（半透明重叠物体 + 噪声背景，依 Wolfe 2005 的刺激描述）。只统计真实目标试次；插入目标的命中率单独作为操纵检验。

**预测（收数据前定稿）**

1. **复现**：block 2 漏报率高于 block 1，预期约 **10–14%** vs 约 7%（区间依据：Wolfe 2005 在 10% 时 16%、50% 时 7%，15% 落在两者之间）。
2. **改进主效应**：block 5 漏报率最低，接近 block 1。
3. **交互（核心）**：block 3（仅插入）部分改善，block 4（仅反馈）改善**有限**（与 Wolfe 2007"单纯诱导无效"一致），block 5 优于两者。
4. **SDT**：各低流行率 block 间 d′ 无显著差异；c 在 block 5 最宽松、block 2 最保守。
5. **退出阈限**：block 5 的正确拒斥 RT 慢于 block 2。

**诚实的说明。** 插入虚拟目标在定义上就是提高有效流行率，所以"插入"与"反馈"**不是完全正交的纯因素**。本设计检验的是：反馈能否提供**流行率之上的增量收益**。

**两处必须写明的代价。**

- **为什么是 15% 而不是 1%**：1% 需要数百试次才拿得到足够的目标试次。Wolfe 2005 自己测的三档里 10% 就有 16% 漏报；Wolfe & Van Wert (2010) 证明效应是流行率的连续函数。代价是效应量从原文的约 23 个百分点缩到 10–15 个百分点。
- **一条对我们不利的证据**：Wolfe & Van Wert (2010) 推断被试约需 **48 个试次**来估计流行率，而我们的 block 只有 30/33 试次，判定标准来不及完全适应 → 会稀释效应。已用拉丁方 + 段间明确重置提示缓解，但不假装消除。

---

## 4. 实验三 · 姿态仪 —— Malcolm Horizon（含双任务）

**复现的现象。** Roscoe (1968)：即便熟悉传统 inside-out 显示的飞行员，用 outside-in 时错误也更少。成因涉及**图形-背景反转**（Johnson & Roscoe, 1972）与**近体/远体空间**冲突（Previc & Ercoline, 1999）。Cohen 等 (2001)：飞行员两种格式无差异（已适应），**非飞行员用 outside-in 显著更好**——我们的被试全是新手，效应更干净。

**改进想法。** Comstock, Jones & Pope (2003, HFES)：显示尺寸"越大越好"，但**加上延伸地平线后各尺寸间的差异被拉平**，连很小的中央显示也能持平。机制是周边视觉才是空间定向的主导通道。因此新条件 = inside-out + **一条贯穿全屏的暗淡地平线光带（Malcolm Horizon）**。

**设计。** 离散试次的异常姿态恢复：平飞 1.5–2.5 s → 突然扰动（滚转 ±30/60/90°，俯仰 ±15°）→ 方向键改平 → |roll| < 5° 且 |pitch| < 5° 保持 2 s 成功，12 s 超时失败。三格式各 12 试次随机混合（共 36），**每格式 6 试次叠加 1-back 数字次级任务**。  
主指标 = **反向操纵率**（首次输入使偏差进一步加大）。

**预测（收数据前定稿）**

1. **复现**：反向操纵率 A（inside-out）> B（outside-in）。
2. **改进主效应**：C（Malcolm Horizon）显著低于 A，接近 B。
3. **增量预测（最有价值）**：**C 的双任务代价最小**——叠加 1-back 时，C 的反向率上升幅度与恢复时长延长幅度均小于 A。这是 MH 相对纯符号学方案最有区分力的预测。
4. 首次输入延迟：C 与 B 短于 A。

**局限。** 网页屏幕视角有限，"周边视野"是**功能近似**而非真实周边视觉；光带亮度固定，若反过来抢夺中央注意，本身也是可报告的结果。

---

## 5. 分析计划（收数据前定稿）

1. **主推断用方向性符号检验，不用配对 t 检验。** 原因：漏报率的分母是目标试次 = 试次 × 流行率 × 人数，这是硬约束。10 人 × 30 试次下，个体水平配对 t 粗估只有 1.0–1.3，大概率不显著。预测已单向预注册 → 可用单尾；**10 人中 ≥8 人方向一致时 p ≈ .055，≥9 人时 p ≈ .011**（`HW.signTestP` 已在 `js/common.js` 实现）。
2. 配对 t / Wilcoxon 只作为**参考**报告，不作为结论依据。
3. 必报效应量与逐被试图，不只报 p 值。
4. 实验二额外报告 d′ 与 c（log-linear 校正，`HW.sdt`），用于区分"标准偏移"与"敏感度变化"。
5. 三个实验**固定顺序、不随机**，顺序效应写入局限。
6. 眼动数据以 `gaze_source` 分组报告；两种来源都有的被试额外报告一致性。

---

## 6. 结果与分析页：收数、效应量与模型可视化

**入口**：`results.html`（首页与三个实验结束页都有入口）。零依赖、纯前端；数字由当前载入的数据**实时计算**，页面不含任何预置结论。

### 6.1 怎么收集 ≥ 5 名他人的数据

1. 把整站部署到 GitHub Pages（默认 HTTPS，`getUserMedia` 可用）；
2. 把 `https://bnu-engpsy-fall26.github.io/GuoYuan202411061049/attention_gy/index.html` 链接发给同学，**每人一个匿名编号**（P01…P10），不收集姓名/学号；
3. 每人按 SEEV → 低流行率 → 姿态仪 的顺序做完，浏览器自动把试次 POST 到 `/api/hw2/submit`；
4. 在结果页点「从实验室接口读取全体数据」，或到 /hw2 页用下载密钥导出 CSV 后上传。

接口 `GET /api/hw2/data?project=HV5WV3[&experiment=seev|prevalence|attitude]` 可匿名读回本项目全体记录。结果页同时拉四个 URL（全体 + 三个实验分表）再做全局去重，兼容 `{ok, records}`、payload 数组、本机导出 JSON、CSV、`trials` 为 JSON 字符串等多种形态；`test_` 调试数据默认排除。

> ⚠️ **去重键必须包含实验内单元**（`condition / block / segment`）：真站点的 `global` 是全场序号，但 CSV 导出或「block 内序号」只在单元内唯一，只按 `_exp|_pid|序号` 去重会跨单元误删试次。

### 6.2 页面给出什么

- **达标检查**：≥ 5 名他人；每条件 ≥ 10 试次（按总试次数核算，并写明低流行率每 block 只有 5 个真实目标这一固有代价）；
- **效应表**：配对均值差、95% CI、Cohen's dz、配对 t（双侧 p）、逐被试方向一致人数、单尾符号检验 p、预注册方向、逐条判定；探索性/无单向预测的效应单独标注，不硬套方向；
- **与原文对比**：只有 Wolfe 等 (2005) 给了可直接比较的漏报率数值；其余文献给的是模型形式或**方向性结论**，页面只做方向一致性判断，**不宣称数值复刻成功**；
- **讨论与必须写明的局限**、**参考文献（含核实状态）**、**导出效应量 CSV / 汇总 JSON**；
- 合成演示数据有红字横幅与图内「演示数据」水印，**不得写入作业结论**；
- 关于「与本课全班数据对比」：该接口只返回本项目（HV5WV3）的记录，不含全班数据；需另外取得全班匿名汇总再上传叠加。页面不虚构其他项目的数据。

### 6.3 8 张模型可视化

| 图                      | 预测线 / 模型                                                    | 依据                                |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- |
| SEEV 预测 vs 实测 PDT（6 点） | `PDT = (B×V)/Σ(B×V)`，本设计的操作化                                | Horrey 等 (2006) 的模型形式             |
| 三仪表事件漏报率               | 价值操控前后                                                      | 本设计新增条件                           |
| 低流行率预测线                | Wolfe (2005) 原文 1%/10%/50% 三点 + 对数插值参考线，叠加本实验 5 个 block 实测  | Wolfe 等 (2005)                    |
| TIP 2×2 五段漏报率          | 与 50% 流行率下 7% 漏报参照线                                         | 本设计新增条件                           |
| **SSTS 预测线**           | RT × set size：目标存在/不存在两条实测回归 + 自终止（斜率 ×0.5）/ 穷尽（斜率 ×1）两条理论线 | Sternberg (1966)                  |
| ROC                    | 等 d′ 曲线 `H = Φ(Φ⁻¹(F)+d′)` 与各 block 的 (虚报率, 命中率) 点          | Wolfe 等 (2007) 的机制假设              |
| 姿态仪三格式 × 单/双任务反向率      | 方向性预测 A > B；C < A 且接近 B                                     | Roscoe (1968) / Comstock 等 (2003) |
| 双任务代价                  | 增量预测：C 的代价最小                                                | 本设计新增预测                           |

> ⚠️ **SSTS 的诚实标注**：SSTS = Serial Self-Terminating Search（序列自终止搜索），出自 Sternberg (1966) 的**短时记忆扫描**范式：若搜索在找到目标时立即停止，目标存在试次的 RT–项目数斜率应约为目标不存在（穷尽全部项目）的一半。本实验是**行李 X 光视觉搜索**，把该斜率比拿来对照属于**跨范式类比外推，不是对 Sternberg 实验的复现**；视觉搜索的 set-size 效应另有其理论（如特征整合理论）。该图只作模型可视化与讨论素材，不用于支持或反驳原文结论。

### 6.4 结束页的个人结果与原理

三个实验结束后，`js/personal.js` 用**与结果页完全相同的统计口径**重算该被试这一次的数据，追加「你个人的结果 + 原理、模型、收数据前的预测 + 全体结果入口」，并明确标注这是单被试描述统计、没有推断。

文件分工：`js/analysis.js`（归一化/统计/效应量/文献锚点，纯函数、可在 Node 单测）、`js/charts.js`（零依赖 canvas 绘图，不引任何 CDN）、`js/results.js`（结果页控制器）、`js/personal.js`（结束页个人结果）。

---


## 7. 参考文献

| 文献                                                                                                                                                                                                                                        | 状态                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Senders, J. W. (1964). The Human Operator as a Monitor and Controller of Multidegree of Freedom Systems. *IEEE Trans. Human Factors in Electronics*, HFE-5(1), 2–5                                                                        | ✅题名卷期已核                                           |
| Wickens, C. D., Goh, J., Helleberg, J., Horrey, W. J., & Talleur, D. A. (2003). Attentional models of multitask pilot performance using advanced display technology. *Human Factors*, 45(3), 360–380. DOI: 10.1518/hfes.45.3.360.27250    | ✅题名卷期页 DOI 已核                                     |
| Horrey, W. J., Wickens, C. D., & Consalus, K. P. (2006). Modeling drivers' visual attention allocation while interacting with in-vehicle technologies. *JEP: Applied*, 12(2), 67–78. DOI: 10.1037/1076-898X.12.2.67                       | ✅已核摘要                                             |
| Eisma, Y. B., Bakay, A., & de Winter, J. (2023). Expectancy or Salience?—Replicating Senders' Dial-Monitoring Experiments With a Gaze-Contingent Window. *Human Factors*, 66(6), 1770–1785. DOI: 10.1177/00187208231176148                | ✅已核摘要（凝视跟随窗口范式的方法学依据）                             |
| Papoutsaki, A., Sangkloy, P., Laskey, J., Daskalova, N., Huang, J., & Hays, J. (2016). WebGazer: Scalable Webcam Eye Tracking Using User Interactions. *IJCAI*, 3839–3845                                                                 | ✅官方引用格式已核                                         |
| Roscoe, S. N. (1968). Airborne Displays for Flight and Navigation. *Human Factors*, 10(4), 321–332. DOI: 10.1177/001872086801000402                                                                                                       | ✅题名卷期页 DOI 已核                                     |
| Comstock, J. R., Jr., Jones, L. C., & Pope, A. T. (2003). *Proc. HFES 47th*, 47(1), 144–148. DOI: 10.1177/154193120304700130                                                                                                              | ✅已核摘要                                             |
| Cohen, D., Otakeno, S., Previc, F. H., & Ercoline, W. R. (2001). *Aviation, Space, and Environmental Medicine*, 72(3), 170–176                                                                                                            | ✅已核摘要                                             |
| Previc, F. H., & Ercoline, W. R. (1999). The "Outside-In" Attitude Display Concept Revisited. *International Journal of Aviation Psychology*, 9(4), 377–401. DOI: 10.1207/s15327108ijap0904_5                                             | ✅题名卷期页 DOI 已核                                     |
| Johnson, S. L., & Roscoe, S. N. (1972). What moves, the airplane or the world? *Human Factors*, 14(2), 107–129. DOI: 10.1177/001872087201400201                                                                                           | ✅题名卷期页 DOI 已核                                     |
| Wolfe, J. M., Horowitz, T. S., & Kenner, N. M. (2005). Rare items often missed in visual searches. *Nature*, 435, 439–440. DOI: 10.1038/435439a                                                                                           | ✅已核原文（PMC4224304）：1%/10%/50% → 30%/16%/7%         |
| Wolfe, J. M., Horowitz, T. S., Van Wert, M. J., Kenner, N. M., Place, S. S., & Kibbi, N. (2007). Low target prevalence is a stubborn source of errors in visual search. *JEP: General*, 136(4), 623–638. DOI: 10.1037/0096-3445.136.4.623 | ✅已核摘要                                             |
| Wolfe, J. M., & Van Wert, M. J. (2010). Varying target prevalence reveals two dissociable decision criteria in visual search. *Current Biology*, 20(2), 121–124. DOI: 10.1016/j.cub.2009.11.066                                           | ✅已核原文（PMC2818748）：c–流行率 r = −0.92；估计窗口约 48 试次     |
| Cutler, V., & Paddock, S. (2009). Use of Threat Image Projection (TIP) to enhance security performance. *Proc. ICCST*, 46–51. DOI: 10.1109/CCST.2009.5335565                                                                              | ✅已核摘要                                             |
| Sternberg, S. (1966). High-speed scanning in human memory. *Science*, 153(3736), 652–654. DOI: 10.1126/science.153.3736.652                                                                                                               | ✅已核原文摘要（结果页 SSTS 预测线的理论出处；**跨范式类比外推，非复现**，见 §6.3） |

**第三方许可**：`vendor/webgazer/` 为 [WebGazer](https://github.com/brownhci/WebGazer)（Brown HCI 组），许可 **GPLv3**（估值 <$10M 的组织可用 LGPLv3）。此处**已改为自托管**：MediaPipe FaceMesh 模型与 wasm 均存于项目内的 `vendor/webgazer/mediapipe/face_mesh/`，默认 tracker 走 `webgazer.params.faceMeshSolutionPath` 的**相对路径**，不请求 tfhub 或任何 CDN。
