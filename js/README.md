# JS 模块说明（RMCreator）

本文档用于说明 `js` 目录下各文件的职责与协作关系，方便后续维护与扩展。

## 总体分层

当前代码按“入口编排 -> 事件输入 -> 渲染输出 -> 业务子系统”拆分：

1. 入口与状态：`main.js`
2. 事件处理：`event.js`
3. 导出子系统：`exports.js`
4. 历史管理：`historyManager.js`
5. 画布与 UI 渲染：`render.js`、`settingsRenderer.js`
6. 文件序列化：`serialization.js`
7. 线条子系统：`line/manager.js`、`line/typeStore.js`、`line/geometry.js`
8. 图形子系统：`shape/manager.js`、`shape/utils.js`
9. 基础设施：`dom.js`、`constants.js`、`utils.js`
10. 颜色选择器：`color-picker-modal.js`

## 文件职责

### `main.js`
- 应用入口文件。
- 持有全局 `state`（工具状态、数据模型、选中状态、拖拽状态等）。
- 负责初始化流程：加载菜单数据、创建各模块实例、绑定事件。
- 负责实体层操作（新增/选择/删除站点、线、文本）和场景重绘调度。
- 负责编排历史管理器与按需持久化快照。
- 负责装配导出管理器（`exports.js`），并把导出动作注入给事件层。

### `exports.js`
- 导出功能集中模块。
- 提供 `SVG` 直接导出（透明底）与 `PNG` 导出（缩放比例、透明背景开关）。
- 负责 PNG 导出模态框的打开/关闭与确认导出逻辑。
- 对导出的 SVG 节点执行清理（去除交互辅助属性和选中态类名）。

### `color-picker-modal.js`
- 颜色选择模态框（原生 RGB + Alpha 通道）。
- 维护历史记录（本地存储），供线条与设置面板复用。
- 对外提供 `open` 方法，传入当前颜色并在确认后回调更新。

### `historyManager.js`
- 撤销/重做的核心状态机。
- 维护 `undo/redo` 栈、当前快照与应用中保护标记。
- 支持高频操作合并（例如拖动颜色时按 coalesceKey 合并为一条历史记录）。

### `event.js`
- 统一处理输入事件。
- 包含工具栏点击、画布鼠标、滚轮缩放、键盘删除、文件菜单（新建/保存/加载/导出/撤销/重做）等事件绑定与回调。
- 只做“输入 -> 状态变更/调用动作”，不直接负责复杂渲染细节。
- 通过注入的回调（如 `addLine`、`selectEntity`）与主流程解耦。
- 键盘快捷键：`Ctrl+Z` 撤销，`Ctrl+Shift+Z` 重做（macOS 兼容 `Cmd`）。

### `serialization.js`
- 负责绘图数据的序列化与反序列化。
- 提供导出 JSON（保存绘图）与解析 JSON（加载绘图）能力。
- 对节点、线条、文本、视口、自定义线型做基础规范化和容错处理。
- 导出 JSON 采用单行压缩格式（不带缩进），减少文件体积。

### `render.js`
- 负责主渲染能力：
  - 子菜单渲染
  - 站点/线条/文本渲染
  - 拖拽光标、视口变换、缩放显示
  - 线条绘制预览
- 组合 `settingsRenderer.js`，对外暴露统一的 `renderSettings`。
- 内含 `ensureEdgeColorList` 用于实例颜色与线型默认颜色对齐。

### `settingsRenderer.js`
- 负责右侧“设置面板”渲染与事件。
- 分别处理站点、线条、文本三类对象的设置 UI。
- 线条设置中包含几何、线型、翻转、圆角、端点偏移与颜色 alpha 编辑。
- 修改设置后触发对应重绘（如 `renderLines`）。

### `line/manager.js`
- 线条管理器（弹窗）逻辑。
- 支持线条类型新建/编辑/删除、导入导出、颜色列表编辑、分段编辑与拖拽排序。
- 负责自动保存到存储（通过 `lineTypeStore`）。
- 与主画布联动：修改线型后可刷新菜单与画布效果。

### `line/typeStore.js`
- 线条类型的数据模型与持久化层。
- 提供默认线型创建、线型标准化、颜色解析、`localStorage` 读写。
- 对外提供 `resolveSegmentColor` 等能力，供渲染层直接使用。

### `line/geometry.js`
- 纯几何计算模块。
- 包括：
  - 不同连线几何（直线、转角等）点集生成
  - 端点偏移计算
  - 并行偏移（多子线）
  - 路径字符串构建（圆角等）
- 不依赖 DOM，适合单独测试与优化。

### `shape/manager.js`
- 图形管理器（弹窗）逻辑。
- 管理图形库、图元编辑、参数列表、画布交互与属性面板。
- 对外提供 `createShapeManager` 供主流程编排。

### `shape/utils.js`
- 图形相关的纯工具与数据规范化。
- 提供图元/参数规范化、SVG 生成、图元解析、渲染辅助方法。
- 对外导出 `shapeParameterTypeDefinitions`、`buildRenderableShapeSvg` 等通用能力。

### `dom.js`
- DOM 引用集中管理。
- 导出页面中常用节点，避免在多个文件重复 `getElementById`。
- 导出 `svgNs` 统一 SVG 创建命名空间。

### `constants.js`
- 常量集中定义。
- 例如几何类型显示名、线形 dash 映射等。
- 减少散落硬编码，统一维护。

### `utils.js`
- 通用工具函数集合。
- 包含数值裁剪、坐标转换、HTML 转义、颜色与 alpha 处理等。
- 尽量保持无副作用，供多个模块复用。

## 依赖关系（简化）

- `main.js` -> `event.js`、`exports.js`、`historyManager.js`、`render.js`、`serialization.js`、`line/manager.js`、`line/typeStore.js`、`shape/manager.js`、`shape/utils.js`
- `render.js` -> `settingsRenderer.js`、`line/geometry.js`、`line/typeStore.js`、`shape/utils.js`
- `settingsRenderer.js` -> `constants.js`、`utils.js`、`shape/utils.js`
- `line/manager.js` -> `line/geometry.js`、`line/typeStore.js`、`utils.js`
- `exports.js` -> `utils.js`
- `event.js` -> `utils.js`
- `color-picker-modal.js` -> `utils.js`

## 维护建议

1. 新增交互行为优先放 `event.js`，避免把事件回调写回 `main.js`。
2. 新增设置项优先放 `settingsRenderer.js`，渲染层保持单一职责。
3. 几何算法改动集中在 `lineGeometry.js`，并保持输入输出纯函数化。
4. 涉及线型存储结构变更时，同步更新 `lineTypeStore.js` 的 normalize/load/save。
5. 修改后建议执行一次构建验证：`pnpm exec vite build`。
6. 当前绘图会自动快照到 `localStorage`（键：`rmcreator.drawing.v1`），刷新页面会自动恢复；调试时如需清空状态可手动删除该键。
7. 快照已改为按需保存：仅在状态发生真实变更（含撤销/重做落地）时写入 `localStorage`，不再按定时器轮询。
8. 高频连续输入（如颜色滑条拖动）建议走 coalesce 模式，避免一次操作产生大量撤销步骤。
