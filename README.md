# RMCreator

纯前端轨道交通设计工作台，一个首页、两个独立工具页面，使用 Vite 统一开发和构建。

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm preview
```

## 页面与目录

- `/`：工具入口主页，代码与样式位于 `shared/home.*`。
- `/route-map/`：原有线路图绘制器。JavaScript、CSS、模板、图标、预设、JSON Schema 分别放在此目录内。
- `/station-designer/`：车站 3D 示意图与分层平面图设计器。`src/` 存放代码和图标，`tests/` 存放功能测试，详细操作见此目录的 README。
- `shared/`：共用主题、工具切换导航和存储键清单。

两个编辑器的顶部品牌可返回首页，旁边的工具菜单可以切换页面。主题沿用 RMCreator 的字体、蓝色强调色、圆角和浮动面板，主页与车站编辑器也会读取线路图设置中的主题色。

## 本地存储

键名集中定义在 `shared/storage-keys.js`，两套作品数据互不覆盖：

| 用途 | 键 |
| --- | --- |
| 线路图作品列表 / 当前作品 | `rmcreator.drawings.v1` / `rmcreator.activeDrawingId.v1` |
| 线路图旧版作品 | `rmcreator.drawing.v1` |
| 线路图自定义线路、图形、站点 | `rmcreator.customLineTypes.v1` / `rmcreator.shapeLibrary.v1` / `rmcreator.stationLibrary.v1` |
| 线路图设置 / 颜色历史 | `rmcreator.appSettings.v1` / `rmcreator.colorHistory.v1` |
| 车站方案库 | `station-studio-workspace` |
| 车站旧版方案 / 恢复备份 | `station-studio-project` / `station-studio-workspace-recovery` |

沿用两套工具的原键，移动到分页后同一源下的旧数据仍可读取。共享主题仅仅读取线路图的主题偏好，不写入或清空任何作品键。线路图的图片缓存 Service Worker 只作用于 `/route-map/`，不会清理其他工具的 Cache Storage。

浏览器存储按协议、域名和端口隔离。原车站设计器若运行于另一个地址，先在原站导出 JSON，再到车站设计分页打开；网页不能直接读取另一个源的 localStorage。原 `StationDesigner` 目录保留。

## 静态部署

构建输出在 `dist/`，直接部署整个目录即可。三个页面均有独立 HTML，不依赖 SPA 回退；刷新或直达工具分页均可。支持部署在站点根目录和子路径。运行时读取的线路图图标、模板、预设和 Schema 会随构建复制到 `dist/route-map/`。

`build.sh` 供 Cloudflare Pages 等环境使用，生成版本提交信息后执行构建。车站设计器的 Three.js 资源只在进入车站分页时加载，首页与线路图不会加载它。
