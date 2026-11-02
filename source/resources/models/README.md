# 内置模型目录

此目录会通过 electron-builder 的 `extraResources` 打包到应用资源目录（运行时位于 `process.resourcesPath/models`）。

## 语音转写（M3 已接入）

采用 `sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30`（流式、纯中文、大模型）与 Silero VAD：

```
resources/models/
├─ silero_vad.onnx                        # ~0.6 MB（VAD 分段）
└─ zipformer-zh/
   ├─ encoder.int8.onnx                   # ~154 MB（zipformer2 大模型，int8 编码器）
   ├─ decoder.onnx                        # ~5 MB（decoder 保留 fp32）
   ├─ joiner.int8.onnx                    # ~1 MB
   └─ tokens.txt                          # ~20 KB
```

目录名 `zipformer-zh` 与文件名由 `electron/recorder/asr-models.cjs` 约定；替换整目录即可升级模型，无需改代码。

> 注意：该模型为 **zipformer2** 架构，worker 里 `modelType` 必须为 `'zipformer2'`
> （用旧的 `'zipformer'` 会在 InitEncoder 读取 attention_dims 时崩溃）。

下载（国内网络用 hf-mirror 镜像）：

```bash
base=https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30/resolve/main
mkdir -p resources/models/zipformer-zh
for f in encoder.int8.onnx decoder.onnx joiner.int8.onnx tokens.txt; do
  curl -L -o resources/models/zipformer-zh/$f $base/$f
done
# VAD（仅首次）
curl -L -o resources/models/silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
```

模型为纯中文流式识别，内置后安装包约增加 155 MB。

## 语音降噪（M3 已接入）

采用 GTCRN 轻量降噪模型（配合 `offline-speech-denoiser`，16 kHz 单声道）：

```
resources/models/
└─ gtcrn_simple.onnx                      # ~0.5 MB（离线降噪）
```

文件名由 `src/main/denoise/models.ts` 约定；替换该文件即可升级模型。

```bash
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx
mv gtcrn_simple.onnx resources/models/
```