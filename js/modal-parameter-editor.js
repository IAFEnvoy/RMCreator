import {
  clamp,
  escapeHtml,
  formatColorWithAlpha,
  normalizeColor
} from "./utils.js";
import {
  normalizeShapeParameterDefault,
  shapeParameterTypeDefinitions
} from "./shape/utils.js";

/**
 * 在安全沙箱中评估 JavaScript 表达式。
 * @param {string} expr - 表达式字符串
 * @param {object} paramValues - { paramName: currentValue } 映射
 * @returns {{ ok: boolean, value?: any, error?: string }}
 */
export function evaluateExpression(expr, paramValues = {}) {
  const trimmed = String(expr || "").trim();
  if (!trimmed) {
    return { ok: false, error: "表达式为空" };
  }
  try {
    const safeParams = {};
    Object.keys(paramValues).forEach((key) => {
      // 只过滤掉可能破坏 JS 语法的字符（引号、反引号、换行等），保留空格和中英文
      const safeKey = key.replace(/["'`\n\r\t\\]/g, "_");
      safeParams[safeKey] = paramValues[key];
    });
    // eslint-disable-next-line no-new-func
    const fn = new Function("params", "Math", "Number", "String", "Boolean", `"use strict"; return (${trimmed});`);
    const result = fn(safeParams, Math, Number, String, Boolean);
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: err.message || "表达式计算失败" };
  }
}

/**
 * 创建参数编辑器模态框。
 * @param {object} options
 * @param {HTMLElement} options.modal - 模态框容器元素
 * @param {object} options.state - 全局状态
 * @param {function} options.colorPicker - 颜色选择器 { open: fn }
 * @param {function} options.onApply - 应用参数变更回调
 * @param {function} options.onStateChanged - 状态变更回调
 */
export function createParameterEditorModal({ modal, state, colorPicker, onStateChanged }) {
  if (!modal) {
    return { open: () => { } };
  }

  const body = modal.querySelector(".param-editor-body");
  const titleEl = modal.querySelector("#paramEditorTitle");
  const cancelBtn = modal.querySelector("#paramEditorCancelBtn");
  const applyBtn = modal.querySelector("#paramEditorApplyBtn");
  const closeBtn = modal.querySelector("#closeParamEditorBtn");
  const applyAllBtn = modal.querySelector("#paramEditorApplyAllBtn");

  let currentContext = null;
  let pendingOnApply = null;
  // currentContext: { type: 'station'|'line'|'text'|'shape', entities: [], params: [], resolveExprEnv: fn }

  const closeModal = () => {
    modal.hidden = true;
    currentContext = null;
    if (body) body.innerHTML = "";
  };

  const close = () => closeModal();

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", close);
  }

  // 点击背板关闭
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      close();
    }
  });

  /**
   * 构建表达式环境中可用的参数名 -> 值映射。
   * includeSelf: 是否包含当前参数自身（用于绑定表达式场景）
   */
  const buildExpressionEnv = (allParams, currentParamIdx, includeSelf = false) => {
    const env = {};
    allParams.forEach((param, idx) => {
      if (!includeSelf && idx === currentParamIdx) return; // 不自引用
      const safeName = param.name || param.label || ("param" + idx);
      env[safeName] = param.value;
    });
    return env;
  };

  /**
   * 渲染参数列表。
   */
  const renderParamList = (ctx) => {
    if (!body) return;
    if (!ctx || !Array.isArray(ctx.entities)) return;

    const typeLabelMap = {
      station: "车站",
      line: "线路",
      text: "文本",
      shape: "图形",
      single: "单参数"
    };
    const count = Array.isArray(ctx.entities) ? ctx.entities.length : 0;
    const typeLabel = typeLabelMap[ctx.type] || "未知";

    let html = `
      <div class="param-editor-info">
        <div class="kv">编辑类型：${escapeHtml(typeLabel)}（已选择 ${count} 个）</div>
        <div class="kv">点击参数旁的「JS」按钮切换为表达式模式，支持引用其他参数（通过 <code>params.参数名</code>）及 Math 函数</div>
      </div>
      <div class="param-list">
    `;

    const params = Array.isArray(ctx.params) ? ctx.params : [];

    params.forEach((param, idx) => {
      const expr = String(param.expression || "").trim();
      const isExpression = expr.length > 0;
      const value = param.value;
      const typeDef = shapeParameterTypeDefinitions[param.type];
      const typeLabel = escapeHtml(typeDef?.label || "文本参数");
      const name = escapeHtml(param.name || param.label || `参数 ${idx + 1}`);

      html += `
        <div class="param-item${isExpression ? " has-expression" : ""}" data-param-index="${idx}">
          <div class="param-item-header">
            <span class="param-item-label" title="${name}">${name}</span>
            <span class="param-item-type">${typeLabel}</span>
            <button type="button" class="param-item-mode-toggle${isExpression ? " is-expression" : ""}" data-mode-toggle="${idx}">${isExpression ? "JS" : "值"}</button>
          </div>
          <div class="param-item-body">
            ${renderValueEditor(idx, param, isExpression)}
          </div>
        </div>
      `;
    });

    html += `</div>`;

    body.innerHTML = html;

    // 绑定事件
    bindParamEvents(ctx);
  };

  const renderValueEditor = (idx, param, isExpression) => {
    if (isExpression) {
      const expr = String(param.expression || "").trim();
      const includeSelf = Boolean(currentContext?.includeSelf);
      const env = buildExpressionEnv(ctxParams(), idx, includeSelf);
      const result = expr ? evaluateExpression(expr, env) : { ok: false, error: "" };
      const previewHtml = result.ok
        ? `<div class="param-expr-preview"><span class="preview-label">预览：</span><span class="preview-value">${escapeHtml(formatPreviewValue(result.value))}</span></div>`
        : "";
      const errorHtml = (!result.ok && expr)
        ? `<div class="param-expr-error">${escapeHtml(result.error || "")}</div>`
        : "";

      // 构建可用变量提示
      const varHints = Object.keys(env).map((key) =>
        `<span class="param-var-hint" data-insert-var="${idx}" data-var-name="${escapeHtml(key)}">params.${escapeHtml(key)}</span>`
      ).join("");

      return `
        <div class="field">
          <textarea class="param-expr-input${(!result.ok && expr) ? " expr-error" : ""}" data-expr-input="${idx}" placeholder="输入 JS 表达式，例如：params.宽度 * 2 或 Math.max(params.高度, 100)">${escapeHtml(expr)}</textarea>
        </div>
        ${varHints ? `<div class="param-var-hints">${varHints}</div>` : ""}
        ${previewHtml}
        ${errorHtml}
      `;
    }

    // 直接值编辑
    const value = param.value;
    const paramId = escapeHtml(String(param.id || idx));

    if (param.type === "color") {
      const normalized = normalizeColor(value || "#2f5d9d");
      return `
        <div class="field">
          <button class="color-modal-trigger" type="button" data-param-color-idx="${idx}" data-color-value="${escapeHtml(normalized)}">
            <span class="color-modal-swatch" style="--swatch-color:${escapeHtml(normalized)}"></span>
            <span class="color-modal-text">${escapeHtml(formatColorWithAlpha(normalized))}</span>
          </button>
        </div>
      `;
    }

    if (param.type === "number") {
      return `
        <div class="field">
          <input type="number" step="0.1" data-param-value-idx="${idx}" value="${Number(value) || 0}" />
        </div>
      `;
    }

    if (param.type === "checkbox") {
      return `
        <div class="field field-toggle">
          <label class="toggle-switch">
            <input class="toggle-checkbox" type="checkbox" data-param-value-idx="${idx}" ${value ? "checked" : ""} />
            <span class="toggle-slider" aria-hidden="true"></span>
          </label>
        </div>
      `;
    }

    if (param.type === "select") {
      const options = Array.isArray(param.options) ? param.options : [];
      return `
        <div class="field">
          <select data-param-value-idx="${idx}">
            ${options.map((opt) => `<option value="${escapeHtml(String(opt.value))}" ${String(opt.value) === String(value) ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
          </select>
        </div>
      `;
    }

    return `
      <div class="field">
        <input type="text" data-param-value-idx="${idx}" value="${escapeHtml(String(value || ""))}" />
      </div>
    `;
  };

  const formatPreviewValue = (val) => {
    if (typeof val === "number") return String(val);
    if (typeof val === "boolean") return val ? "true" : "false";
    if (typeof val === "string") return val.length > 40 ? val.slice(0, 40) + "…" : val;
    if (val === null || val === undefined) return "(空)";
    return String(val).slice(0, 40);
  };

  const ctxParams = () => {
    if (!currentContext) return [];
    return Array.isArray(currentContext.params) ? currentContext.params : [];
  };

  const getParam = (idx) => {
    const params = ctxParams();
    return (idx >= 0 && idx < params.length) ? params[idx] : null;
  };

  const updateParam = (idx, updates) => {
    const params = ctxParams();
    if (idx < 0 || idx >= params.length) return;
    Object.assign(params[idx], updates);
  };

  const bindParamEvents = (ctx) => {
    if (!body) return;

    // 模式切换
    body.querySelectorAll("[data-mode-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-mode-toggle"));
        const param = getParam(idx);
        if (!param) return;
        const currentExpr = String(param.expression || "").trim();
        if (currentExpr) {
          // 从表达式切换到直接值：清空表达式
          updateParam(idx, { expression: "" });
        } else {
          // 从直接值切换到表达式：初始化表达式为当前值的字符串形式
          const val = param.value;
          let initExpr = "";
          if (typeof val === "string") initExpr = JSON.stringify(val);
          else if (typeof val === "number") initExpr = String(val);
          else if (typeof val === "boolean") initExpr = val ? "true" : "false";
          else initExpr = String(val);
          updateParam(idx, { expression: initExpr });
        }
        renderParamList(currentContext);
      });
    });

    // 表达式输入
    body.querySelectorAll("[data-expr-input]").forEach((textarea) => {
      const idx = Number(textarea.getAttribute("data-expr-input"));
      const applyExpr = () => {
        updateParam(idx, { expression: textarea.value });
        renderParamList(currentContext);
      };
      textarea.addEventListener("input", () => {
        // 实时预览 - 节流更新
        updateParam(idx, { expression: textarea.value });
        // 简单实时反馈：更新预览区
        const includeSelf = Boolean(currentContext?.includeSelf);
        const env = buildExpressionEnv(ctxParams(), idx, includeSelf);
        const result = evaluateExpression(textarea.value, env);
        const previewEl = textarea.closest(".param-item")?.querySelector(".param-expr-preview");
        const errorEl = textarea.closest(".param-item")?.querySelector(".param-expr-error");
        if (previewEl) {
          const valueSpan = previewEl.querySelector(".preview-value");
          if (valueSpan && result.ok) {
            valueSpan.textContent = formatPreviewValue(result.value);
            previewEl.style.display = "";
          } else if (previewEl) {
            previewEl.style.display = result.ok ? "" : "none";
          }
        }
        if (errorEl) {
          errorEl.textContent = result.error || "";
          errorEl.style.display = (result.ok || !textarea.value.trim()) ? "none" : "";
        }
        textarea.classList.toggle("expr-error", !result.ok && textarea.value.trim().length > 0);
      });
      textarea.addEventListener("change", applyExpr);
      textarea.addEventListener("blur", applyExpr);
    });

    // 变量提示点击插入
    body.querySelectorAll("[data-insert-var]").forEach((hint) => {
      hint.addEventListener("click", () => {
        const idx = Number(hint.getAttribute("data-insert-var"));
        const varName = hint.getAttribute("data-var-name") || "";
        const textarea = body.querySelector(`[data-expr-input="${idx}"]`);
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const text = textarea.value;
          textarea.value = text.slice(0, start) + varName + text.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + varName.length;
          textarea.focus();
          updateParam(idx, { expression: textarea.value });
        }
      });
    });

    // 直接值：数字/文本/checkbox
    body.querySelectorAll("[data-param-value-idx]").forEach((input) => {
      const idx = Number(input.getAttribute("data-param-value-idx"));
      const param = getParam(idx);
      if (!param) return;

      const apply = () => {
        let nextValue;
        if (input.type === "checkbox") {
          nextValue = Boolean(input.checked);
        } else if (input.type === "number" || param.type === "number") {
          nextValue = Number(input.value) || 0;
        } else if (input.tagName === "SELECT") {
          nextValue = input.value;
        } else {
          nextValue = input.value;
        }
        updateParam(idx, { value: normalizeShapeParameterDefault(param.type, nextValue) });
      };

      if (input.type === "checkbox") {
        input.addEventListener("change", () => {
          apply();
          // 更新 checkbox 的切换状态视觉效果
          const toggleSpan = input.closest(".field-toggle")?.querySelector("input.toggle-checkbox");
          if (toggleSpan) toggleSpan.checked = input.checked;
        });
      } else {
        input.addEventListener("input", apply);
        input.addEventListener("change", apply);
      }
    });

    // 颜色按钮
    body.querySelectorAll("[data-param-color-idx]").forEach((button) => {
      const idx = Number(button.getAttribute("data-param-color-idx"));
      const param = getParam(idx);
      if (!param) return;

      const applyColor = (color) => {
        const normalized = normalizeColor(color);
        updateParam(idx, { value: normalized });
        button.dataset.colorValue = normalized;
        const swatch = button.querySelector(".color-modal-swatch");
        if (swatch) swatch.style.setProperty("--swatch-color", normalized);
        const text = button.querySelector(".color-modal-text");
        if (text) text.textContent = formatColorWithAlpha(normalized);
      };

      applyColor(button.dataset.colorValue || "#2f5d9dff");
      button.addEventListener("click", () => {
        if (!colorPicker) return;
        colorPicker.open({
          color: button.dataset.colorValue,
          title: "参数颜色",
          onConfirm: applyColor
        });
      });
    });
  };

  /**
   * 收集当前模态框中所有参数的最终值（含表达式求值）。
   */
  const collectFinalParams = () => {
    if (!currentContext) return [];
    const params = Array.isArray(currentContext.params) ? currentContext.params : [];
    const includeSelf = Boolean(currentContext?.includeSelf);
    return params.map((param, idx) => {
      const expr = String(param.expression || "").trim();
      let finalValue = param.value;
      if (expr) {
        const env = buildExpressionEnv(params, idx, includeSelf);
        const result = evaluateExpression(expr, env);
        if (result.ok) {
          finalValue = normalizeShapeParameterDefault(param.type, result.value);
        }
        // 如果表达式无效，保留原值
      }
      return {
        ...param,
        finalValue,
        expression: expr || undefined
      };
    });
  };

  /**
   * 应用当前编辑结果。
   */
  const applyChanges = () => {
    if (!currentContext || typeof pendingOnApply !== "function") return;
    const finalParams = collectFinalParams();
    pendingOnApply({
      type: currentContext.type,
      entities: currentContext.entities,
      params: finalParams
    });
    if (typeof onStateChanged === "function") {
      onStateChanged({ coalesceKey: "param-editor-apply" });
    }
  };

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyChanges();
      close();
    });
  }

  if (applyAllBtn) {
    applyAllBtn.addEventListener("click", () => {
      applyChanges();
    });
  }

  /**
   * 打开参数编辑器。
   * @param {object} context
   * @param {string} context.type - 'station'|'line'|'text'|'shape'
   * @param {Array} context.entities - 受影响的实体对象列表
   * @param {Array} context.params - 参数描述列表 [{ name, id, type, value, expression?, options? }]
   * @param {function} context.onApply - 应用回调
   */
  const open = (context) => {
    if (!context) return;
    currentContext = {
      type: context.type,
      entities: Array.isArray(context.entities) ? context.entities : [],
      includeSelf: Boolean(context.includeSelf),
      params: (Array.isArray(context.params) ? context.params : []).map((p) => ({
        name: p.name || "",
        id: p.id || "",
        type: p.type || "text",
        value: p.value,
        expression: p.expression || "",
        options: p.options || []
      }))
    };
    pendingOnApply = typeof context.onApply === "function" ? context.onApply : null;

    if (titleEl) {
      const typeLabelMap = { station: "车站", line: "线路", text: "文本", shape: "图形", single: "单参数" };
      titleEl.textContent = `参数编辑器 - ${typeLabelMap[currentContext.type] || "未知"}`;
    }

    renderParamList(currentContext);
    modal.hidden = false;
  };

  return { open, close };
}
