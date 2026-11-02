'use strict'

const { existsSync } = require('fs')
const { join } = require('path')
const { modelsRoot } = require('./resources.cjs')

/** GTCRN 轻量降噪模型文件名；替换该文件即可升级模型。 */
const GTCRN_FILE = 'gtcrn_simple.onnx'

/** 模型标识（写入元数据，便于将来区分来源）。 */
const DENOISE_MODEL_ID = 'gtcrn_simple'

/** GTCRN 模型绝对路径。 */
function resolveDenoiseModel() {
  return join(modelsRoot(), GTCRN_FILE)
}

function checkDenoiseAvailability() {
  const model = resolveDenoiseModel()
  if (!existsSync(model)) {
    return {
      available: false,
      message: `缺少降噪模型：${GTCRN_FILE}`,
      model: DENOISE_MODEL_ID
    }
  }
  return { available: true, model: DENOISE_MODEL_ID }
}

module.exports = { DENOISE_MODEL_ID, resolveDenoiseModel, checkDenoiseAvailability }
