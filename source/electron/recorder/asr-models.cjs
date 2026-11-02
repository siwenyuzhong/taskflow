'use strict'

const { existsSync } = require('fs')
const { join } = require('path')
const { modelsRoot } = require('./resources.cjs')

/** 模型目录名；替换该目录即可升级模型，无需改代码。 */
const ZIPFORMER_DIR = 'zipformer-zh'

/** 模型标识（写入转写结果，便于将来区分来源）。 */
const ASR_MODEL_ID = 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30'

function resolveAsrModels() {
  const root = modelsRoot()
  const z = join(root, ZIPFORMER_DIR)
  return {
    encoder: join(z, 'encoder.int8.onnx'),
    decoder: join(z, 'decoder.onnx'),
    joiner: join(z, 'joiner.int8.onnx'),
    tokens: join(z, 'tokens.txt'),
    vad: join(root, 'silero_vad.onnx')
  }
}

const FILE_KEYS = ['encoder', 'decoder', 'joiner', 'tokens', 'vad']

function checkAsrAvailability() {
  const models = resolveAsrModels()
  const missing = FILE_KEYS.filter((k) => !existsSync(models[k]))
  if (missing.length > 0) {
    return {
      available: false,
      message: `缺少模型文件：${missing.join('、')}`,
      model: ASR_MODEL_ID
    }
  }
  return { available: true, model: ASR_MODEL_ID }
}

module.exports = { ASR_MODEL_ID, resolveAsrModels, checkAsrAvailability }
