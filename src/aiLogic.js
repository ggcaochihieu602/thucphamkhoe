function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateBMI(height, weight) {
  const h = toNumber(height);
  const w = toNumber(weight);
  if (!h || !w) return null;
  const meters = h / 100;
  if (!meters) return null;
  return w / (meters * meters);
}

function normalizeGoal(goal) {
  const value = String(goal || "balanced").trim().toLowerCase();
  if (value === "muscle_gain") {
    return "weight_gain";
  }
  if (value === "weight_loss" || value === "weight_gain" || value === "balanced") {
    return value;
  }
  return "balanced";
}

function inferGoalFromProfile(userProfile = {}) {
  const bmi = calculateBMI(userProfile.height, userProfile.weight);
  const hasProfile =
    toNumber(userProfile.age) > 0 ||
    !!String(userProfile.gender || "").trim() ||
    toNumber(userProfile.height) > 0 ||
    toNumber(userProfile.weight) > 0 ||
    !!String(userProfile.activity_level || "").trim();

  if (!hasProfile) {
    return {
      goal: "balanced",
      reason: "Chưa có đủ dữ liệu hồ sơ nên hệ thống ưu tiên mục tiêu cân bằng.",
      confidence: "low"
    };
  }

  // Align goal inference with standard adult BMI categories.
  if (bmi !== null) {
    if (bmi < 18.5) {
      return {
        goal: "weight_gain",
        reason: "BMI hiện tại dưới 18.5 nên hệ thống ưu tiên mục tiêu tăng cân hợp lý và bổ sung năng lượng.",
        confidence: bmi < 17 ? "high" : "medium"
      };
    }

    if (bmi >= 25) {
      return {
        goal: "weight_loss",
        reason: "BMI hiện tại từ 25 trở lên nên hệ thống ưu tiên mục tiêu giảm cân và kiểm soát năng lượng.",
        confidence: bmi >= 30 ? "high" : "medium"
      };
    }

    return {
      goal: "balanced",
      reason: "BMI hiện tại nằm trong khoảng 18.5 đến dưới 25 nên hệ thống ưu tiên duy trì vóc dáng và bữa ăn cân bằng.",
      confidence: "medium"
    };
  }

  if (bmi !== null && bmi < 18.5) {
    return {
      goal: "weight_gain",
      reason: "Chỉ số cơ thể hiện tại nghiêng về hướng nên ưu tiên kiểm soát năng lượng.",
      confidence: bmi < 17 ? "high" : "medium"
    };
  }

  if (bmi !== null && bmi >= 25) {
    return {
      goal: "weight_loss",
      reason: "Thể trạng và mức vận động hiện tại gợi ý bạn có thể hướng tới mục tiêu tăng cân hợp lý.",
      confidence: bmi >= 30 ? "high" : "medium"
    };
  }

  return {
    goal: "balanced",
    reason: "Hồ sơ hiện tại phù hợp hơn với việc duy trì bữa ăn cân bằng và vóc dáng ổn định.",
    confidence: "medium"
  };
}

function getPersonalizationFactors(userProfile = {}) {
  const age = toNumber(userProfile.age) || 30;
  const gender = String(userProfile.gender || "").trim().toLowerCase() || "unknown";
  const activityLevel = String(userProfile.activity_level || "moderate").trim().toLowerCase();
  const bmi = calculateBMI(userProfile.height, userProfile.weight);

  const factors = {
    calorieMultiplier: 1.0,
    proteinMultiplier: 1.0,
    fatMultiplier: 1.0,
    carbsMultiplier: 1.0
  };

  if (age >= 50) {
    factors.calorieMultiplier *= 0.92;
    factors.proteinMultiplier *= 1.08;
  } else if (age <= 25) {
    factors.calorieMultiplier *= 1.06;
  }

  if (gender === "male") {
    factors.proteinMultiplier *= 1.08;
    factors.calorieMultiplier *= 1.08;
  } else if (gender === "female") {
    factors.calorieMultiplier *= 0.94;
    factors.proteinMultiplier *= 0.95;
  }

  if (activityLevel === "low") {
    factors.calorieMultiplier *= 0.86;
    factors.carbsMultiplier *= 0.88;
  } else if (activityLevel === "high") {
    factors.calorieMultiplier *= 1.14;
    factors.carbsMultiplier *= 1.12;
    factors.proteinMultiplier *= 1.06;
  }

  if (bmi !== null && bmi >= 25) {
    factors.calorieMultiplier *= 0.9;
    factors.fatMultiplier *= 0.92;
  } else if (bmi !== null && bmi < 18.5) {
    factors.calorieMultiplier *= 1.1;
    factors.proteinMultiplier *= 1.05;
  }

  return factors;
}

function getProfileContext(userProfile = {}) {
  const bmi = calculateBMI(userProfile.height, userProfile.weight);
  const age = toNumber(userProfile.age);
  const activityLevel = String(userProfile.activity_level || "moderate").trim().toLowerCase();
  const hasProfile =
    age > 0 ||
    !!String(userProfile.gender || "").trim() ||
    toNumber(userProfile.height) > 0 ||
    toNumber(userProfile.weight) > 0 ||
    !!String(userProfile.activity_level || "").trim();

  return {
    bmi,
    age: age || null,
    activityLevel,
    hasProfile,
    mode: hasProfile ? "personalized" : "generic"
  };
}

function getFeedbackRecord(userProfileOrUserId, productId) {
  if (!userProfileOrUserId || typeof userProfileOrUserId !== "object") return null;
  const feedbackMap = userProfileOrUserId.feedback_map || {};
  return feedbackMap[String(productId)] || feedbackMap[productId] || null;
}

function getDynamicWeights(userProfileOrUserId, productId) {
  const feedback = getFeedbackRecord(userProfileOrUserId, productId);
  const weights = { protein: 1.0, calories: 1.0, fat: 1.0, carbs: 1.0 };

  if (!feedback) return weights;

  const rating = toNumber(feedback.rating);
  if (rating >= 4) {
    weights.protein *= 1.12;
    weights.calories *= 1.05;
  } else if (rating > 0 && rating <= 2) {
    weights.protein *= 0.94;
    weights.calories *= 0.95;
  }

  return weights;
}

function getUserFeedbackBonus(userProfileOrUserId, productId) {
  const feedback = getFeedbackRecord(userProfileOrUserId, productId);
  if (!feedback) return 0;

  const rating = toNumber(feedback.rating);
  if (rating >= 4) return 4;
  if (rating > 0 && rating <= 2) return -4;
  return 0;
}

function normalizeFoodRole(role) {
  const value = String(role || "").trim().toLowerCase();
  const allowed = new Set([
    "protein_anchor",
    "carb_base",
    "fat_support",
    "vegetable_support",
    "mixed_support",
    "extreme_condiment"
  ]);
  return allowed.has(value) ? value : "";
}

function inferFoodRole(product = {}) {
  const explicitRole = normalizeFoodRole(product.food_role);
  if (explicitRole) return explicitRole;

  const name = String(product.name || "").trim().toLowerCase();
  const category = String(product.category || "").trim().toLowerCase();
  const nutrition = getNutrition(product);
  const calories = nutrition.calories;
  const protein = nutrition.protein;
  const fat = nutrition.fat;
  const carbs = nutrition.carbs;

  const extremeKeywords = ["mỡ heo", "bơ thực vật", "mayonnaise", "đường", "bột năng"];
  if (extremeKeywords.some((keyword) => name.includes(keyword))) {
    return "extreme_condiment";
  }

  const vegKeywords = [
    "rau", "cải", "xà lách", "súp lơ", "dưa leo", "cà rốt", "củ dền",
    "bí đỏ", "nấm", "ớt chuông", "hành tây", "tỏi"
  ];
  if (vegKeywords.some((keyword) => name.includes(keyword))) {
    return "vegetable_support";
  }

  const proteinKeywords = ["ức gà", "cá hồi", "sữa chua", "đậu nành"];
  if (proteinKeywords.some((keyword) => name.includes(keyword)) || (protein >= 12 && protein >= carbs && fat <= 25)) {
    return "protein_anchor";
  }

  const carbKeywords = ["khoai", "yến mạch", "quinoa", "đậu gà", "đậu lăng", "bắp ngô", "bột mì"];
  if (carbKeywords.some((keyword) => name.includes(keyword)) || (carbs >= 20 && carbs >= protein && fat <= 20)) {
    return "carb_base";
  }

  const fatKeywords = ["hạt", "bơ", "cá hồi"];
  if (fatKeywords.some((keyword) => name.includes(keyword)) || (fat >= 10 && calories >= 120 && protein <= 35)) {
    return "fat_support";
  }

  if (category.includes("rau") || category.includes("củ") || category.includes("quả")) {
    return "vegetable_support";
  }

  return "mixed_support";
}

function isExtremeBalanceItem(product = {}) {
  return inferFoodRole(product) === "extreme_condiment";
}

function inferCategoryBoost(goal, category) {
  const normalized = String(category || "").trim().toLowerCase();
  if (!normalized) return { delta: 0, note: "" };

  if (goal === "weight_loss") {
    if (normalized.includes("rau") || normalized.includes("cu") || normalized.includes("qua")) {
      return { delta: 6, note: "Nhóm thực phẩm này thường phù hợp cho mục tiêu kiểm soát năng lượng." };
    }
    if (normalized.includes("sua")) {
      return { delta: 2, note: "Có thể hợp nếu bạn ưu tiên loại giàu đạm, ít đường." };
    }
  }

  if (goal === "weight_gain") {
    if (normalized.includes("sua") || normalized.includes("ngu coc")) {
      return { delta: 4, note: "Nhóm này có thể hỗ trợ năng lượng và phục hồi khi tập luyện." };
    }
  }

  if (normalized.includes("rau") || normalized.includes("cu") || normalized.includes("qua")) {
    return { delta: 4, note: "Nhóm thực phẩm này phù hợp cho bữa ăn cân bằng hơn." };
  }

  return { delta: 0, note: "" };
}

function buildLevel(score) {
  if (score >= 80) return "nên ưu tiên";
  if (score >= 60) return "có thể chọn";
  if (score >= 40) return "cần cân nhắc";
  return "nên hạn chế";
}

function addRule(result, delta, type, code, message) {
  result.score += delta;
  const target = type === "warning" ? result.warningRules : result.matchedRules;
  target.push({ code, delta, message });
  result.reasons.push(message);
}

function generatePersonalizedTip(goal, userProfile = {}, result = {}) {
  const profile = getProfileContext(userProfile);
  const warnings = result.warningRules || [];

  if (goal === "weight_loss") {
    if (warnings.some((item) => item.code === "high_carb")) {
      return "Nếu đang giảm mỡ, hãy ưu tiên món giàu đạm hơn hoặc giảm bớt phần tinh bột trong cùng bữa ăn.";
    }
    if (profile.activityLevel === "high") {
      return "Bạn vẫn cần đủ carb để tập luyện, nhưng nên chọn sản phẩm có tỉ lệ đạm tốt hơn để giữ cơ.";
    }
    return "Ưu tiên sản phẩm có protein tốt, năng lượng vừa phải và kết hợp thêm rau để no lâu hơn.";
  }

  if (goal === "weight_gain") {
    if (warnings.some((item) => item.code === "low_protein")) {
      return "Sản phẩm này nên đi kèm một nguồn đạm rõ ràng hơn như sữa chua Greek, trứng, gà hoặc whey.";
    }
    return "Để tăng cân hợp lý, nên tăng năng lượng từ nguồn carb và chất béo tốt, đồng thời vẫn giữ protein đủ cho phục hồi.";
  }

  if (profile.bmi !== null && profile.bmi >= 25) {
    return "Với thể trạng hiện tại, ưu tiên sản phẩm cân bằng, ít đường và kiểm soát khẩu phần sẽ hợp hơn.";
  }

  return "Hãy xem đây là một thành phần trong bữa ăn cân bằng, không chỉ dựa vào một chỉ số dinh dưỡng duy nhất.";
}

function buildProductSummary(goal, result, profile, confidence) {
  const best = result.matchedRules[0];
  const warning = result.warningRules[0];

  if (best && !warning) {
    return best.message;
  }

  if (best && warning) {
    return best.message + " Tuy nhiên, " + warning.message.toLowerCase();
  }

  if (warning) {
    return warning.message;
  }

  if (profile.mode === "personalized") {
    return "Gợi ý được điều chỉnh theo hồ sơ của bạn, nhưng hiện chưa có nhiều điểm nổi bật trong dữ liệu dinh dưỡng.";
  }

  if (confidence.label === "low") {
    return "Dữ liệu dinh dưỡng còn thiếu, vì vậy kết quả này chỉ nên xem là tham khảo.";
  }

  return goal === "balanced"
    ? "Sản phẩm này ở mức trung tính cho bữa ăn cân bằng."
    : "Sản phẩm này ở mức trung tính cho mục tiêu hiện tại.";
}

function getCartTargetRatios(goal) {
  // Tỉ lệ mục tiêu khi chuẩn hóa calories = 1
  if (goal === "weight_loss") {
    return { calories: 1, protein: 0.0750, carbs: 0.1000, fat: 0.0333 };
  }
  if (goal === "weight_gain") {
    return { calories: 1, protein: 0.0625, carbs: 0.1250, fat: 0.0278 };
  }
  // balanced
  return { calories: 1, protein: 0.0500, carbs: 0.1250, fat: 0.0333 };
}

function getCartTargetRanges(goal) {
  if (goal === "weight_loss") {
    return {
      protein: { min: 0.0625, max: 0.0875 },
      carbs: { min: 0.0750, max: 0.1125 },
      fat: { min: 0.0222, max: 0.0389 }
    };
  }
  if (goal === "weight_gain") {
    return {
      protein: { min: 0.0500, max: 0.0750 },
      carbs: { min: 0.1125, max: 0.1500 },
      fat: { min: 0.0222, max: 0.0333 }
    };
  }
  return {
    protein: { min: 0.0375, max: 0.0625 },
    carbs: { min: 0.1000, max: 0.1375 },
    fat: { min: 0.0222, max: 0.0389 }
  };
}

function calculateCartRatios(totalCalories, totalProtein, totalCarbs, totalFat) {
  if (totalCalories <= 0 || totalProtein <= 0 || totalCarbs <= 0 || totalFat <= 0) {
    return null;
  }
  // Tính tỉ lệ tương đối so với calories
  // calories làm mẫu số = 1 (tương đối)
  return {
    calories: 1,
    protein: totalProtein / totalCalories,
    carbs: totalCarbs / totalCalories,
    fat: totalFat / totalCalories
  };
}

function compareRatios(cartRatios, targetRatios) {
  // Tính chênh lệch trực tiếp so với mục tiêu
  const differences = {
    protein: cartRatios.protein - targetRatios.protein,
    carbs: cartRatios.carbs - targetRatios.carbs,
    fat: cartRatios.fat - targetRatios.fat
  };
  
  // Xác định trạng thái - ngưỡng ±15%
  const proteinStatus = differences.protein > (targetRatios.protein * 0.15) ? "high" : differences.protein < -(targetRatios.protein * 0.15) ? "low" : "ok";
  const carbsStatus = differences.carbs > (targetRatios.carbs * 0.15) ? "high" : differences.carbs < -(targetRatios.carbs * 0.15) ? "low" : "ok";
  const fatStatus = differences.fat > (targetRatios.fat * 0.15) ? "high" : differences.fat < -(targetRatios.fat * 0.15) ? "low" : "ok";
  
  return { proteinStatus, carbsStatus, fatStatus, differences };
}

function compareRatiosToRanges(cartRatios, targetRanges, targetRatios) {
  const nutrients = ["protein", "carbs", "fat"];
  const differences = {};
  const statuses = {};

  for (const nutrient of nutrients) {
    const current = cartRatios[nutrient];
    const range = targetRanges[nutrient];
    const midpoint = targetRatios[nutrient];
    const softMin = range.min * 0.7;
    const softMax = range.max * 1.3;
    differences[nutrient] = current - midpoint;
    statuses[nutrient] =
      current < softMin ? "low" :
      current > softMax ? "high" :
      "ok";
  }

  return {
    proteinStatus: statuses.protein,
    carbsStatus: statuses.carbs,
    fatStatus: statuses.fat,
    differences,
    ranges: targetRanges
  };
}
function buildCartAdvice(goal, findings, summary, profile, ratioComparison = null) {
  const hardWarningCodes = new Set([
    "cart_low_protein",
    "cart_high_protein",
    "cart_low_carbs",
    "cart_high_carbs",
    "cart_low_fat",
    "cart_high_fat"
  ]);
  const hardWarnings = findings.filter((item) => item.type === "warning" && hardWarningCodes.has(item.code));
  const topPositive = findings.find((item) => item.type === "match");

  if (!hardWarnings.length) {
    if (profile.mode === "personalized") {
      return "Giỏ hàng hiện đã tương đối cân bằng so với mục tiêu và khá dễ tiếp tục hoàn thiện bằng vài lựa chọn nhỏ.";
    }
    return "Giỏ hàng hiện đã tương đối cân bằng so với mục tiêu. Bạn có thể thêm nhẹ theo nhu cầu thực tế.";
  }

  if (hardWarnings.length === 1 && topPositive) {
    return `Giỏ hàng đã tương đối cân bằng. ${topPositive.message} Tuy nhiên vẫn còn một điểm lệch nhẹ: ${hardWarnings[0].message.toLowerCase()}`;
  }

  if (hardWarnings.length === 1) {
    return `Giỏ hàng đã tương đối cân bằng, nhưng vẫn còn một điểm cần chỉnh: ${hardWarnings[0].message.toLowerCase()}`;
  }

  return hardWarnings[0].message;
}

function generateCartSuggestionsFromNeeds(goal, needs, summary) {
  const suggestions = [];

  if (needs.protein === "low") {
    suggestions.push("Giỏ hàng đang thiếu protein, nên thêm nhóm đạm chính như ức gà, cá hồi, sữa chua không đường hoặc đậu nành.");
  }
  if (needs.carbs === "low") {
    suggestions.push("Giỏ hàng đang thiếu tinh bột nền, nên thêm khoai lang, yến mạch, quinoa hoặc các loại đậu giàu carb.");
  }
  if (needs.fat === "low") {
    suggestions.push("Giỏ hàng đang thiếu chất béo tốt, nên thêm hạt, cá béo hoặc quả bơ để cân bằng hơn.");
  }
  if (needs.vegetables === "low") {
    suggestions.push("Giỏ hàng chưa có đủ rau củ hỗ trợ độ no và chất xơ, nên bổ sung thêm rau xanh hoặc nhóm củ quả ít chế biến.");
  }

  if (!suggestions.length && summary.excludedExtremeItems > 0) {
    suggestions.push("Phân tích tỷ lệ đã bỏ qua nhóm gia vị hoặc chất béo cực trị, nên ưu tiên cân bằng bằng thực phẩm chính thay vì thêm đồ phụ trợ.");
  }

  if (!suggestions.length) {
    if (goal === "weight_loss") {
      suggestions.push("Giỏ hàng đang nằm trong khoảng mục tiêu giảm cân, hãy giữ protein ổn định và ưu tiên rau để dễ duy trì.");
    } else if (goal === "weight_gain") {
      suggestions.push("Giỏ hàng đang nằm trong khoảng mục tiêu tăng cân, hãy giữ đủ món nền giàu năng lượng và một nguồn đạm rõ ràng.");
    } else {
      suggestions.push("Giỏ hàng đang nằm trong khoảng mục tiêu cân bằng, chỉ cần phân bổ khẩu phần hợp lý trong ngày.");
    }
  }

  return suggestions.slice(0, 4);
}

function getCartHealthCompatibilityWarnings(items, userProfile = {}, summary = null) {
  const conditions = new Set(toStringArray(userProfile.health_conditions));
  const preferences = new Set(toStringArray(userProfile.diet_preferences));

  if (!conditions.size && !preferences.size) {
    return [];
  }

  const totals = summary || {
    totalProtein: 0,
    totalFat: 0,
    totalCarbs: 0,
    totalFiber: 0,
    totalSugar: 0,
    totalSodium: 0,
    totalSaturatedFat: 0,
    totalCholesterol: 0,
    roleCounts: {}
  };

  const contributors = {
    sodium: [],
    saturatedFat: [],
    cholesterol: [],
    sugar: [],
    carbs: [],
    fat: [],
    protein: [],
    animalCalories: []
  };

  let animalCalories = 0;
  let totalCalories = 0;
  let vegetarianMatchedCalories = 0;
  let lowFatTaggedCount = 0;

  for (const item of items) {
    const qty = toNumber(item.quantity) || 1;
    const nutrition = getNutrition(item);
    const role = inferFoodRole(item);
    const healthTags = getProductTagSet(item, "health_tags");
    const dietFlags = getProductTagSet(item, "diet_flags");
    const calories = nutrition.calories * qty;
    const name = String(item.name || "Sản phẩm").trim() || "Sản phẩm";

    totalCalories += calories;

    contributors.sodium.push({ name, value: nutrition.sodium * qty, role });
    contributors.saturatedFat.push({ name, value: nutrition.saturatedFat * qty, role });
    contributors.cholesterol.push({ name, value: nutrition.cholesterol * qty, role });
    contributors.sugar.push({ name, value: nutrition.sugar * qty, role });
    contributors.carbs.push({ name, value: nutrition.carbs * qty, role });
    contributors.fat.push({ name, value: nutrition.fat * qty, role });
    contributors.protein.push({ name, value: nutrition.protein * qty, role });

    if (healthTags.has("low_fat") || dietFlags.has("low_fat")) {
      lowFatTaggedCount += 1;
    }

    const vegetarianFriendly =
      dietFlags.has("vegetarian") ||
      dietFlags.has("vegan") ||
      healthTags.has("vegetarian_friendly");

    if (vegetarianFriendly) {
      vegetarianMatchedCalories += calories;
    }

    if (isLikelyAnimalProduct(item)) {
      animalCalories += calories;
      contributors.animalCalories.push({ name, value: calories, role });
    }
  }

  function topContributors(metric, total, minShare = 0.35, limit = 2) {
    if (!total) return [];
    return contributors[metric]
      .filter((item) => item.value > 0 && item.value / total >= minShare)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((item) => item.name);
  }

  function pushWarning(list, title, message, products = []) {
    list.push({
      title,
      message,
      products: [...new Set(products)].slice(0, 2)
    });
  }

  const warnings = [];
  const carbBaseCount = toNumber(totals.roleCounts && totals.roleCounts.carb_base);
  const extremeCount = toNumber(totals.roleCounts && totals.roleCounts.extreme_condiment);

  if (conditions.has("hypertension")) {
    if (totals.totalSodium >= 900) {
      pushWarning(
        warnings,
        "Kiểm soát huyết áp",
        "Tổng natri của giỏ hàng đang khá cao so với hướng ăn uống cần kiểm soát huyết áp.",
        topContributors("sodium", totals.totalSodium)
      );
    } else if (totals.totalSodium >= 700 && extremeCount > 0) {
      pushWarning(
        warnings,
        "Kiểm soát huyết áp",
        "Giỏ hàng chưa quá cao natri nhưng đang có món thuộc nhóm cực trị, nên cân nhắc nếu bạn cần ăn nhạt hơn.",
        topContributors("sodium", totals.totalSodium, 0.25)
      );
    }
  }

  if (conditions.has("heart_disease")) {
    if (totals.totalSaturatedFat >= 12 || totals.totalCholesterol >= 220 || totals.totalSodium >= 900) {
      pushWarning(
        warnings,
        "Ưu tiên tim mạch",
        "Tổng chất béo bão hòa, cholesterol hoặc natri của giỏ hàng đang hơi cao cho hướng ăn uống tốt cho tim mạch.",
        [
          ...topContributors("saturatedFat", totals.totalSaturatedFat, 0.3),
          ...topContributors("cholesterol", totals.totalCholesterol, 0.3),
          ...topContributors("sodium", totals.totalSodium, 0.3)
        ]
      );
    }
  }

  if (conditions.has("kidney_disease")) {
    if (totals.totalSodium >= 850 || totals.totalProtein >= 85) {
      pushWarning(
        warnings,
        "Lưu ý cho thận",
        "Tổng natri hoặc tổng đạm của giỏ hàng đang ở mức nên thận trọng hơn nếu bạn có vấn đề về thận.",
        [
          ...topContributors("sodium", totals.totalSodium, 0.3),
          ...topContributors("protein", totals.totalProtein, 0.3)
        ]
      );
    }
  }

  if (conditions.has("liver_disease")) {
    if (totals.totalSugar >= 35 || totals.totalSaturatedFat >= 14 || (totals.totalFat >= 45 && extremeCount > 0)) {
      pushWarning(
        warnings,
        "Lưu ý cho gan",
        "Giỏ hàng đang có xu hướng nhiều đường hoặc chất béo hơn mức nên ưu tiên nếu bạn đang theo chế độ ăn thận trọng cho gan.",
        [
          ...topContributors("sugar", totals.totalSugar, 0.3),
          ...topContributors("saturatedFat", totals.totalSaturatedFat, 0.3)
        ]
      );
    }
  }

  if (preferences.has("low_salt") && totals.totalSodium >= 700) {
    pushWarning(
      warnings,
      "Nguyên tắc ăn nhạt",
      "Tổng natri của giỏ hàng đang hơi cao so với nguyên tắc ăn nhạt hoặc ít muối.",
      topContributors("sodium", totals.totalSodium, 0.3)
    );
  }

  if (preferences.has("low_fat") && totals.totalFat >= 40 && (totals.totalSaturatedFat >= 10 || lowFatTaggedCount === 0)) {
    pushWarning(
      warnings,
      "Nguyên tắc ăn ít chất béo",
      "Giỏ hàng hiện hơi giàu chất béo hơn mức nên ưu tiên nếu bạn đang theo hướng ăn ít chất béo.",
      topContributors("fat", totals.totalFat, 0.3)
    );
  }

  if (preferences.has("low_carb") && (totals.totalCarbs >= 80 || (totals.totalCarbs >= 65 && carbBaseCount >= 2 && totals.totalSugar >= 18))) {
    pushWarning(
      warnings,
      "Nguyên tắc ăn ít tinh bột",
      "Giỏ hàng có nhóm tinh bột nền khá rõ, nên giảm bớt nếu bạn đang theo low-carb nghiêm ngặt.",
      topContributors("carbs", totals.totalCarbs, 0.25)
    );
  }

  if (preferences.has("vegetarian")) {
    const animalShare = totalCalories > 0 ? animalCalories / totalCalories : 0;
    if (animalShare >= 0.25 && vegetarianMatchedCalories < totalCalories * 0.6) {
      pushWarning(
        warnings,
        "Lựa chọn ăn chay",
        "Giỏ hàng hiện vẫn có tỷ trọng đáng kể từ thực phẩm nguồn gốc động vật nên chưa thật sự phù hợp với lựa chọn ăn chay.",
        topContributors("animalCalories", animalCalories, 0.25)
      );
    }
  }

  return warnings.slice(0, 3);
}
function toStringArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  }

  if (typeof value !== "string") {
    return [];
  }

  const raw = value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
    }
  } catch (_) {}

  return [...new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function isLikelyAnimalProduct(product = {}) {
  const text = `${product.name || ""} ${product.category || ""}`.toLowerCase();
  return /(ga|heo|bo|ca |cá|tom|tôm|muc|mực|hai san|hải sản|thit|thịt|trung|trứng|sua|sữa|yogurt|pho mai|phô mai)/.test(text);
}

function recordUserFeedback(userId, productId, rating, comment) {
  return {
    userId,
    productId,
    rating,
    comment: comment || ""
  };
}

function parseTagArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  }

  if (typeof value !== "string") {
    return [];
  }

  const raw = value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
    }
  } catch (_) {}

  return raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.replace(/^"+|"+$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

function getProductTagSet(product = {}, fieldName) {
  return new Set(parseTagArray(product[fieldName]));
}

function productHasTag(product = {}, fieldName, expected) {
  return getProductTagSet(product, fieldName).has(String(expected || "").trim().toLowerCase());
}

function getNutrition(product = {}) {
  const priceUnit = String(product.price_unit || "").toLowerCase();
  const multiplier = priceUnit.includes("kg") ? 10 : 1;

  return {
    calories: toNumber(product.calories) * multiplier,
    protein: toNumber(product.protein) * multiplier,
    fat: toNumber(product.fat) * multiplier,
    carbs: toNumber(product.carbs) * multiplier,
    sodium: toNumber(product.sodium) * multiplier,
    sugar: toNumber(product.sugar) * multiplier,
    saturatedFat: toNumber(product.saturated_fat) * multiplier,
    fiber: toNumber(product.fiber) * multiplier,
    cholesterol: toNumber(product.cholesterol) * multiplier
  };
}

function computeConfidence(product = {}) {
  const fields = [
    product.calories,
    product.protein,
    product.fat,
    product.carbs,
    product.sodium,
    product.sugar,
    product.saturated_fat,
    product.fiber,
    product.cholesterol,
    product.food_role,
    product.health_tags,
    product.diet_flags
  ];
  const presentCount = fields.filter((value) => value !== undefined && value !== null && value !== "").length;

  if (presentCount >= 10) return { label: "high", score: 0.95 };
  if (presentCount >= 7) return { label: "medium", score: 0.78 };
  return { label: "low", score: 0.55 };
}

function applyStageTwoHealthRules(result, product, nutrition, userProfile = {}) {
  const role = inferFoodRole(product);
  const conditions = new Set(toStringArray(userProfile.health_conditions));
  const preferences = new Set(toStringArray(userProfile.diet_preferences));
  const healthTags = getProductTagSet(product, "health_tags");
  const dietFlags = getProductTagSet(product, "diet_flags");
  const sodium = nutrition.sodium;
  const sugar = nutrition.sugar;
  const saturatedFat = nutrition.saturatedFat;
  const cholesterol = nutrition.cholesterol;
  const fiber = nutrition.fiber;
  const fat = nutrition.fat;
  const carbs = nutrition.carbs;
  const protein = nutrition.protein;

  if (conditions.has("hypertension")) {
    if (sodium >= 350 || saturatedFat >= 5 || role === "extreme_condiment") {
      addRule(result, -22, "warning", "health_hypertension_caution", "Món này không phải lựa chọn ưu tiên cho người cần kiểm soát huyết áp.");
    }
    if (healthTags.has("low_sodium") || healthTags.has("heart_friendly")) {
      addRule(result, 14, "match", "health_hypertension_fit", "Sản phẩm có dấu hiệu phù hợp hơn cho nhu cầu kiểm soát huyết áp.");
    }
  }

  if (conditions.has("heart_disease")) {
    if (saturatedFat >= 4 || cholesterol >= 60 || sodium >= 320 || role === "extreme_condiment") {
      addRule(result, -22, "warning", "health_heart_caution", "Món này cần thận trọng hơn với người có vấn đề tim mạch.");
    }
    if (healthTags.has("heart_friendly") || (healthTags.has("low_fat") && healthTags.has("low_sodium"))) {
      addRule(result, 14, "match", "health_heart_fit", "Sản phẩm có nhãn sức khỏe hỗ trợ hướng ăn uống thận trọng cho tim mạch.");
    }
  }

  if (conditions.has("kidney_disease")) {
    if (healthTags.has("kidney_caution") || sodium >= 300 || protein >= 20) {
      addRule(result, -24, "warning", "health_kidney_caution", "Món này không nên được ưu tiên cao cho người có vấn đề về thận.");
    }
    if (role === "vegetable_support" && sodium <= 140) {
      addRule(result, 10, "match", "health_kidney_fit", "Món này nhẹ hơn và dễ cân nhắc hơn trong giai đoạn ưu tiên cho thận.");
    }
  }

  if (conditions.has("liver_disease")) {
    if (fat >= 15 || saturatedFat >= 4 || sugar >= 15 || role === "extreme_condiment") {
      addRule(result, -20, "warning", "health_liver_caution", "Món này không phải lựa chọn ưu tiên cho người cần ăn thanh nhẹ và dễ tiêu hóa hơn.");
    }
    if (healthTags.has("liver_friendly") || (healthTags.has("low_fat") && sugar <= 8)) {
      addRule(result, 12, "match", "health_liver_fit", "Sản phẩm có xu hướng phù hợp hơn với hướng ăn uống thận trọng cho gan.");
    }
  }

  if (preferences.has("low_salt")) {
    if (sodium >= 250 || role === "extreme_condiment") {
      addRule(result, -18, "warning", "diet_low_salt_caution", "Món này chưa phù hợp với ưu tiên ăn nhạt hoặc ít muối.");
    }
    if (healthTags.has("low_sodium") || dietFlags.has("low_salt")) {
      addRule(result, 10, "match", "diet_low_salt_fit", "Sản phẩm đã có nhãn phù hợp với cách ăn ít muối.");
    }
  }

  if (preferences.has("low_fat")) {
    if (fat >= 12 || saturatedFat >= 4 || role === "extreme_condiment") {
      addRule(result, -16, "warning", "diet_low_fat_caution", "Món này có xu hướng nhiều chất béo hơn mức ưu tiên hiện tại.");
    }
    if (healthTags.has("low_fat") || dietFlags.has("low_fat")) {
      addRule(result, 10, "match", "diet_low_fat_fit", "Sản phẩm có dấu hiệu phù hợp với cách ăn ít chất béo.");
    }
  }

  if (preferences.has("low_carb")) {
    if (carbs >= 22 || sugar >= 10) {
      addRule(result, -15, "warning", "diet_low_carb_caution", "Món này có lượng carb hoặc đường khá cao so với ưu tiên hiện tại.");
    }
    if (dietFlags.has("low_carb") || (healthTags.has("diabetes_friendly") && carbs <= 15)) {
      addRule(result, 10, "match", "diet_low_carb_fit", "Sản phẩm có nhãn hỗ trợ tốt hơn cho cách ăn ưu tiên giảm bớt tinh bột.");
    }
  }

  if (preferences.has("vegetarian")) {
    if (dietFlags.has("vegetarian") || dietFlags.has("vegan") || healthTags.has("vegetarian_friendly")) {
      addRule(result, 12, "match", "diet_vegetarian_fit", "Sản phẩm có nhãn phù hợp hơn với lựa chọn ăn chay.");
    } else if (isLikelyAnimalProduct(product)) {
      addRule(result, -26, "warning", "diet_vegetarian_caution", "Món này có khả năng là thực phẩm nguồn gốc động vật nên không hợp với lựa chọn ăn chay.");
    }
  }

  if (fiber >= 3) {
    addRule(result, 7, "match", "fiber_support", "Lượng chất xơ là điểm cộng tốt cho độ no và cân bằng bữa ăn.");
  }

  if (sugar >= 12) {
    addRule(result, -8, "warning", "high_sugar", "Lượng đường không thấp, nên cân nhắc tần suất sử dụng.");
  }

  if (sodium >= 400) {
    addRule(result, -8, "warning", "high_sodium", "Lượng natri khá cao, không lý tưởng nếu bạn đang cần kiểm soát muối.");
  }

  if (saturatedFat >= 5) {
    addRule(result, -7, "warning", "high_saturated_fat", "Chất béo bão hòa không thấp, nên cân đối với các món nhẹ hơn.");
  }
}

function analyzeProductForGoal(product, goal, userProfile = {}) {
  const normalizedGoal = normalizeGoal(goal);
  const nutrition = getNutrition(product);
  const profile = getProfileContext(userProfile);
  const personalization = getPersonalizationFactors(userProfile);
  const dynamicWeights = getDynamicWeights(userProfile, product.id);
  const confidence = computeConfidence(product);
  const categoryBoost = inferCategoryBoost(normalizedGoal, product.category);

  const calories = nutrition.calories;
  const protein = nutrition.protein;
  const fat = nutrition.fat;
  const carbs = nutrition.carbs;
  const sugar = nutrition.sugar;
  const fiber = nutrition.fiber;
  const proteinDensity = calories > 0 ? (protein * 100) / calories : 0;

  const result = {
    score: 50,
    reasons: [],
    matchedRules: [],
    warningRules: [],
    personalization_factors: personalization,
    dynamic_weights: dynamicWeights,
    profile_mode: profile.mode,
    confidence: confidence.label,
    confidence_score: confidence.score
  };

  if (!calories && !protein && !fat && !carbs) {
    addRule(result, -12, "warning", "missing_core_nutrition", "Dữ liệu dinh dưỡng còn thiếu nên độ tin cậy của gợi ý không cao.");
  }

  applyStageTwoHealthRules(result, product, nutrition, userProfile);

  if (normalizedGoal === "weight_loss") {
    const calorieLow = 160 * personalization.calorieMultiplier;
    const calorieHigh = 320 * personalization.calorieMultiplier;
    const fatLimit = 18 * personalization.fatMultiplier;
    const carbLimit = profile.activityLevel === "high" ? 55 : 42 * personalization.carbsMultiplier;

    if (calories > 0 && calories <= calorieLow) {
      addRule(result, 15 * dynamicWeights.calories, "match", "low_calorie", "Năng lượng mỗi khẩu phần khá gọn, hợp với mục tiêu giảm mỡ.");
    } else if (calories >= calorieHigh) {
      addRule(result, -14 * dynamicWeights.calories, "warning", "high_calorie", "Sản phẩm này có năng lượng khá cao so với mục tiêu giảm mỡ.");
    }

    if (proteinDensity >= 10 * dynamicWeights.protein) {
      addRule(result, 16 * dynamicWeights.protein, "match", "good_protein_density", "Tỷ lệ protein trên calories khá tốt, hỗ trợ no lâu và giữ cơ.");
    } else if (protein > 0 && proteinDensity < 6) {
      addRule(result, -10, "warning", "low_protein_density", "Protein chưa nổi bật so với lượng năng lượng của sản phẩm.");
    }

    if (fat >= fatLimit) {
      addRule(result, -8 * dynamicWeights.fat, "warning", "high_fat", "Lượng chất béo khá cao, nên cân nhắc khẩu phần nếu đang siết năng lượng.");
    }

    if (carbs >= carbLimit) {
      addRule(result, -7, "warning", "high_carb", "Lượng carb khá cao cho mục tiêu giảm mỡ, nhất là khi vận động không nhiều.");
    }

    if (fiber >= 2.5) {
      addRule(result, 6, "match", "weight_loss_fiber", "Lượng chất xơ khá ổn, hỗ trợ độ no lâu hơn khi kiểm soát cân nặng.");
    }

    if (sugar >= 10) {
      addRule(result, -6, "warning", "weight_loss_sugar", "Lượng đường khá dễ đẩy tổng năng lượng lên nhanh khi đang giảm cân.");
    }
  } else if (normalizedGoal === "weight_gain") {
    const calorieMin = 180 * personalization.calorieMultiplier;
    const calorieMax = 480 * personalization.calorieMultiplier;
    const proteinMin = 14 * personalization.proteinMultiplier;

    if (calories >= calorieMin && calories <= calorieMax) {
      addRule(result, 12 * dynamicWeights.calories, "match", "training_energy", "Lượng năng lượng khá hợp để bổ sung quanh bữa ăn hoặc buổi tập.");
    } else if (calories > 0 && calories < 120) {
      addRule(result, -8, "warning", "too_light_for_gain", "Năng lượng hơi thấp nếu bạn đang cần tăng cân và cần dư năng lượng.");
    }

    if (protein >= proteinMin) {
      addRule(result, 14 * dynamicWeights.protein, "match", "high_protein", "Hàm lượng protein khá ổn để hỗ trợ phục hồi và duy trì khối nạc khi tăng cân.");
    } else if (protein > 0 && protein < 12) {
      addRule(result, -8, "warning", "low_protein", "Protein chưa đủ tốt nếu bạn muốn tăng cân mà vẫn giữ cân bằng dinh dưỡng.");
    }

    if (profile.activityLevel === "high" && carbs >= 20) {
      addRule(result, 6, "match", "training_carbs", "Có lượng carb hỗ trợ bổ sung năng lượng cho tập luyện.");
    }
  } else {
    if (calories > 0 && calories <= 320 * personalization.calorieMultiplier) {
      addRule(result, 10 * dynamicWeights.calories, "match", "balanced_calorie", "Lượng năng lượng ở mức dễ xếp vào bữa ăn cân bằng hơn.");
    } else if (calories > 420 * personalization.calorieMultiplier) {
      addRule(result, -10, "warning", "energy_dense", "Năng lượng khá đậm đặc, nên cân đối với các món nhẹ hơn trong ngày.");
    }

    if (protein >= 10 * personalization.proteinMultiplier) {
      addRule(result, 8 * dynamicWeights.protein, "match", "balanced_protein", "Sản phẩm có đóng góp protein khá ổn cho bữa ăn hằng ngày.");
    }

    if (fiber >= 2.5) {
      addRule(result, 5, "match", "balanced_fiber", "Lượng chất xơ hỗ trợ cân bằng bữa ăn hằng ngày tốt hơn.");
    }
  }

  if (categoryBoost.delta !== 0) {
    addRule(
      result,
      categoryBoost.delta,
      categoryBoost.delta > 0 ? "match" : "warning",
      "category_signal",
      categoryBoost.note
    );
  }

  const feedbackBonus = getUserFeedbackBonus(userProfile, product.id);
  if (feedbackBonus > 0) {
    addRule(result, feedbackBonus, "match", "user_positive_feedback", "Lich su danh gia cua ban cho thay nhom san pham nay hop khau vi hon.");
  } else if (feedbackBonus < 0) {
    addRule(result, feedbackBonus, "warning", "user_negative_feedback", "Lịch sử đánh giá của bạn cho thấy bạn từng không thích sản phẩm tương tự.");
  }

  if (product.expert_feedback) {
    result.expert_signal = "Co nhan xet chuyen gia";
  }

  result.score = clamp(Math.round(result.score), 0, 100);
  result.level = buildLevel(result.score);
  result.tip = generatePersonalizedTip(normalizedGoal, userProfile, result);
  result.summary = buildProductSummary(normalizedGoal, result, profile, confidence);

  return result;
}

function analyzeCartForGoal(items, goal, userProfile = {}) {
  const normalizedGoal = normalizeGoal(goal);
  const profile = getProfileContext(userProfile);
  const targetRatios = getCartTargetRatios(normalizedGoal);
  const targetRanges = getCartTargetRanges(normalizedGoal);

  let totalCalories = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  let totalFiber = 0;
  let totalSugar = 0;
  let totalSodium = 0;
  let totalSaturatedFat = 0;
  let totalCholesterol = 0;

  let balanceCalories = 0;
  let balanceProtein = 0;
  let balanceFat = 0;
  let balanceCarbs = 0;

  const categories = new Set();
  const roleCounts = {
    protein_anchor: 0,
    carb_base: 0,
    fat_support: 0,
    vegetable_support: 0,
    mixed_support: 0,
    extreme_condiment: 0
  };
  let productsWithNutrition = 0;

  for (const item of items) {
    const qty = toNumber(item.quantity) || 1;
    const nutrition = getNutrition(item);
    const role = inferFoodRole(item);

    totalCalories += nutrition.calories * qty;
    totalProtein += nutrition.protein * qty;
    totalFat += nutrition.fat * qty;
    totalCarbs += nutrition.carbs * qty;
    totalFiber += nutrition.fiber * qty;
    totalSugar += nutrition.sugar * qty;
    totalSodium += nutrition.sodium * qty;
    totalSaturatedFat += nutrition.saturatedFat * qty;
    totalCholesterol += nutrition.cholesterol * qty;

    if (nutrition.calories || nutrition.protein || nutrition.fat || nutrition.carbs) {
      productsWithNutrition += 1;
    }

    roleCounts[role] = (roleCounts[role] || 0) + qty;

    if (!isExtremeBalanceItem(item)) {
      balanceCalories += nutrition.calories * qty;
      balanceProtein += nutrition.protein * qty;
      balanceFat += nutrition.fat * qty;
      balanceCarbs += nutrition.carbs * qty;
    }

    if (item.category) {
      categories.add(String(item.category || "").trim().toLowerCase());
    }
  }

  const summary = {
    totalCalories: Math.round(totalCalories),
    totalProtein: Math.round(totalProtein * 10) / 10,
    totalFat: Math.round(totalFat * 10) / 10,
    totalCarbs: Math.round(totalCarbs * 10) / 10,
    totalFiber: Math.round(totalFiber * 10) / 10,
    totalSugar: Math.round(totalSugar * 10) / 10,
    totalSodium: Math.round(totalSodium),
    totalSaturatedFat: Math.round(totalSaturatedFat * 10) / 10,
    totalCholesterol: Math.round(totalCholesterol),
    categoryDiversity: categories.size,
    balanceCalories: Math.round(balanceCalories),
    roleCounts,
    excludedExtremeItems: roleCounts.extreme_condiment || 0
  };

  const cartRatios = calculateCartRatios(balanceCalories, balanceProtein, balanceCarbs, balanceFat);
  const ratioComparison = cartRatios ? compareRatiosToRanges(cartRatios, targetRanges, targetRatios) : null;

  const findings = [];
  const pushFinding = (type, code, message) => findings.push({ type, code, message });
  const needs = {
    protein: "ok",
    carbs: "ok",
    fat: "ok",
    vegetables: roleCounts.vegetable_support > 0 ? "ok" : "low"
  };

  if (ratioComparison) {
    if (ratioComparison.proteinStatus === "low") {
      pushFinding("warning", "cart_low_protein", "Giỏ hàng thiếu protein so với khoảng mục tiêu.");
      needs.protein = "low";
    } else if (ratioComparison.proteinStatus === "high") {
      pushFinding("warning", "cart_high_protein", "Giỏ hàng đang dồn quá nhiều protein so với mục tiêu.");
      needs.protein = "high";
    } else {
      pushFinding("match", "cart_protein_ok", "Tỷ lệ protein đang nằm trong khoảng mục tiêu.");
    }

    if (ratioComparison.carbsStatus === "low") {
      pushFinding("warning", "cart_low_carbs", "Giỏ hàng thiếu tinh bột nền so với khoảng mục tiêu.");
      needs.carbs = "low";
    } else if (ratioComparison.carbsStatus === "high") {
      pushFinding("warning", "cart_high_carbs", "Giỏ hàng đang nhiều carb hơn khoảng mục tiêu.");
      needs.carbs = "high";
    } else {
      pushFinding("match", "cart_carbs_ok", "Tỷ lệ carb đang nằm trong khoảng mục tiêu.");
    }

    if (ratioComparison.fatStatus === "low") {
      pushFinding("warning", "cart_low_fat", "Giỏ hàng thiếu chất béo tốt so với khoảng mục tiêu.");
      needs.fat = "low";
    } else if (ratioComparison.fatStatus === "high") {
      pushFinding("warning", "cart_high_fat", "Giỏ hàng đang nhiều chất béo hơn khoảng mục tiêu.");
      needs.fat = "high";
    } else {
      pushFinding("match", "cart_fat_ok", "Tỷ lệ chất béo đang nằm trong khoảng mục tiêu.");
    }
  }

  if (summary.totalFiber >= 6) {
    pushFinding("match", "cart_has_fiber", "Giỏ hàng đã có đóng góp chất xơ khá tốt.");
  } else if (summary.totalFiber > 0) {
    pushFinding("note", "cart_fiber_moderate", "Giỏ hàng đã có chất xơ nhưng vẫn có thể bổ sung thêm rau củ hoặc thực phẩm nhiều xơ.");
  } else {
    pushFinding("note", "cart_low_fiber", "Giỏ hàng đang rất ít chất xơ.");
  }

  if (summary.totalSodium >= 800) {
    pushFinding("warning", "cart_high_sodium", "Tổng natri của giỏ hàng đang khá cao.");
  }

  if (summary.totalSugar >= 25) {
    pushFinding("warning", "cart_high_sugar", "Tổng đường của giỏ hàng đang ở mức cần theo dõi.");
  }

  if (needs.vegetables === "low") {
    pushFinding("note", "cart_low_vegetables", "Giỏ hàng chưa có nhóm rau củ hỗ trợ độ no và cân bằng bữa ăn.");
  } else {
    pushFinding("match", "cart_has_vegetables", "Giỏ hàng đã có nhóm rau củ hỗ trợ cân bằng bữa ăn.");
  }

  if (summary.categoryDiversity <= 1 && items.length >= 2) {
    pushFinding("note", "cart_low_variety", "Giỏ hàng ít nhóm thực phẩm, nên bổ sung thêm sự đa dạng.");
  }

  if (summary.excludedExtremeItems > 0) {
    pushFinding("match", "cart_extremes_ignored", "Nhóm gia vị hoặc chất béo cực trị đã được loại khỏi phần cân tỷ lệ dinh dưỡng.");
  }

  const confidenceRatio = items.length ? productsWithNutrition / items.length : 0;
  const confidence =
    confidenceRatio >= 0.9 ? { label: "high", score: 0.95 } :
    confidenceRatio >= 0.6 ? { label: "medium", score: 0.78 } :
    { label: "low", score: 0.5 };

  const healthWarnings = getCartHealthCompatibilityWarnings(items, userProfile, summary);
  if (healthWarnings.length) {
    pushFinding(
      "warning",
      "cart_health_profile_mismatch",
      "Một số sản phẩm trong giỏ hàng chưa phù hợp với bệnh lý hoặc nguyên tắc ăn uống hiện tại."
    );
  }

  const advice = buildCartAdvice(normalizedGoal, findings, summary, profile, ratioComparison);
  const suggestions = generateCartSuggestionsFromNeeds(normalizedGoal, needs, summary);

  return {
    summary,
    advice,
    findings,
    suggestions,
    needs,
    targetRatios,
    targetRanges,
    cartRatios,
    ratioComparison,
    healthWarnings,
    profile_mode: profile.mode,
    confidence: confidence.label,
    confidence_score: confidence.score
  };
}

module.exports = {
  analyzeProductForGoal,
  analyzeCartForGoal,
  inferGoalFromProfile,
  inferFoodRole,
  isExtremeBalanceItem,
  recordUserFeedback,
  getPersonalizationFactors,
  getDynamicWeights
};
