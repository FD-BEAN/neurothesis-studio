# NeuroThesis Studio

面向 EEG + VR 实验型研究生论文的中文优先研究工作台原型。

当前版本是纯静态网页，可以直接部署到 GitHub Pages。它包含：

- 项目总览
- 论文阅读示例
- 文献矩阵
- 实验设计
- EEG / 数据分析示例
- Python / MNE 与 MATLAB / EEGLAB 分析脚本骨架
- 英文论文草稿与中文逻辑说明

## 本地打开

直接双击打开：

```text
index.html
```

或在浏览器中打开项目目录下的 `index.html`。

## GitHub Pages 部署

1. 在 GitHub 新建一个 public repo，例如 `neurothesis-studio`。
2. 把本项目推送到该 repo。
3. 打开 repo 的 `Settings` -> `Pages`。
4. `Source` 选择 `Deploy from a branch`。
5. `Branch` 选择 `main`，目录选择 `/root`。
6. 保存后等待 1-2 分钟。

部署完成后，访问地址通常是：

```text
https://你的用户名.github.io/neurothesis-studio/
```

## 隐私提醒

当前原型只适合放 demo 数据。不要把真实实验数据、EEG 文件、未公开论文草稿、API key 或个人隐私信息提交到 public repo。
