
function isRecord$1(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value) {
  return isRecord$1(value) && Object.values(value).every((v) => typeof v === "string");
}

function validateCustomProvider(input) {
  const errors = {};
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) {
    errors["id"] = "只能用小写字母、数字和连字符，且以字母开头";
  }
  if (input.name.trim() === "") {
    errors["name"] = "请填写显示名称";
  }
  let parsed;
  try {
    parsed = new URL(input.baseUrl);
  } catch {
    parsed = void 0;
  }
  if (parsed === void 0) {
    errors["baseUrl"] = "请填写完整地址，如 https://api.example.com/v1";
  } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    errors["baseUrl"] = "只支持 http 或 https";
  }
  if (input.models.length === 0) {
    errors["models"] = "至少填一个模型";
  } else if (input.models.some((m) => m.id.trim() === "")) {
    errors["models"] = "模型 ID 不能为空";
  } else {
    const ids = input.models.map((m) => m.id.trim());
    if (new Set(ids).size !== ids.length) errors["models"] = "模型 ID 不能重复";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

function validateCustomModel(model) {
  const errors = [];
  if (model.id.trim() === "") errors.push("请填写模型 ID");
  if (!(model.contextWindow > 0)) errors.push("上下文窗口需大于 0");
  if (!(model.maxTokens > 0)) errors.push("单次最大输出需大于 0");
  return errors;
}

export {
	isRecord$1,
	isStringRecord,
	validateCustomModel,
	validateCustomProvider,
};