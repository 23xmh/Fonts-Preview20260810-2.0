# 本机字体浏览器 · GitHub Pages 静态版

此目录可以直接部署到 GitHub Pages，不需要 Python、Node.js、数据库或构建步骤。

## 部署

1. 新建一个 GitHub 仓库。
2. 把本目录中的全部文件上传到仓库根目录。
3. 打开仓库的 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**。
5. 选择 `main` 分支和 `/ (root)` 目录，然后保存。
6. 等待 GitHub 给出 `https://<用户名>.github.io/<仓库名>/` 地址。

请通过 GitHub Pages 的 HTTPS 地址，在桌面版 Microsoft Edge 或 Google Chrome 中访问。首次点击“读取本机字体”时，需要允许网页访问本机字体。

## 静态版限制

- 字体名称、预览和分类只在浏览器内处理，不会上传字体文件。
- GitHub Pages 无法访问 Windows 字体目录或注册表，因此不能进行本地版的磁盘文件二次校验。
- 如果浏览器仍保留已经删除字体的缓存，请完全退出并重新启动浏览器后再次扫描。
- Firefox 和 Safari 若不提供 Local Font Access API，页面无法读取完整的本机字体列表。

## 文件

- `index.html`：页面入口
- `styles.css`：界面样式
- `app.js`：字体读取、分类、搜索与预览逻辑
- `favicon.svg`：站点图标
- `.nojekyll`：让 GitHub Pages 原样发布静态文件
