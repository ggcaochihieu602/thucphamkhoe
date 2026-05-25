function analyzeProductForGoal(product, goal, userProfile = {}) {
  const calories = product.calories || 0;
  const protein = product.protein || 0;
  const fat = product.fat || 0;
  const carbs = product.carbs || 0;

  const proteinPer100Kcal = calories > 0 ? (protein * 4 * 100) / (calories * 1.0) : 0;

  // Personalization factors
  const personalization = getPersonalizationFactors(userProfile);
  const dynamicWeights = getDynamicWeights(userProfile.id, product.id);

  let score = 50;
  const reasons = [];

  if (goal === "weight_loss") {
    // Base calories adjustment
    const adjustedCaloriesLow = 200 * personalization.calorieMultiplier;
    const adjustedCaloriesHigh = 400 * personalization.calorieMultiplier;
    
    if (calories <= adjustedCaloriesLow) {
      score += 20 * dynamicWeights.calories;
      reasons.push("Lượng calories mỗi khẩu phần tương đối thấp, phù hợp giảm mỡ");
    } else if (calories >= adjustedCaloriesHigh) {
      score -= 15 * dynamicWeights.calories;
      reasons.push("Lượng calories khá cao, nên kiểm soát khẩu phần nếu muốn giảm mỡ");
    }

    // Protein adjustment based on gender/age
    const adjustedProteinThreshold = 20 * personalization.proteinMultiplier;
    if (proteinPer100Kcal >= adjustedProteinThreshold) {
      score += 15 * dynamicWeights.protein;
      reasons.push("Tỉ lệ protein trên calories cao, hỗ trợ no lâu và giữ cơ");
    } else if (proteinPer100Kcal < 10 * personalization.proteinMultiplier) {
      score -= 10 * dynamicWeights.protein;
      reasons.push("Tỉ lệ protein trên calories thấp, ít phù hợp với mục tiêu giữ cơ khi giảm mỡ");
    }

    // Fat adjustment
    const adjustedFatThreshold = 15 * personalization.fatMultiplier;
    if (fat >= adjustedFatThreshold) {
      score -= 10 * dynamicWeights.fat;
      reasons.push("Lượng chất béo khá cao, nên ăn hạn chế nếu đang siết cân");
    }
  } else if (goal === "weight_gain") {
    const adjustedCaloriesMin = 200 * personalization.calorieMultiplier;
    const adjustedCaloriesMax = 450 * personalization.calorieMultiplier;
    
    if (calories >= adjustedCaloriesMin && calories <= adjustedCaloriesMax) {
      score += 15 * dynamicWeights.calories;
      reasons.push("Lượng calories vừa phải cho giai đoạn tăng cơ");
    }

    const adjustedProteinMin = 20 * personalization.proteinMultiplier;
    if (protein >= adjustedProteinMin) {
      score += 20 * dynamicWeights.protein;
      reasons.push("Hàm lượng protein cao, tốt cho phục hồi và tăng cơ");
    } else if (protein < 15 * personalization.proteinMultiplier) {
      score -= 10 * dynamicWeights.protein;
      reasons.push("Protein hơi thấp, nên kết hợp thêm nguồn đạm khác");
    }
  } else {
    if (calories <= 250 * personalization.calorieMultiplier) {
      score += 10 * dynamicWeights.calories;
      reasons.push("Lượng calories ở mức chấp nhận được cho bữa ăn hàng ngày");
    }

    if (fat > 20 * personalization.fatMultiplier) {
      score -= 10 * dynamicWeights.fat;
      reasons.push("Chất béo khá cao, nên cân nhắc không ăn quá thường xuyên");
    }
  }

  // Carbs adjustment based on activity level
  if (carbs >= 50 && goal === "weight_loss") {
    const carbsPenalty = 5 * personalization.carbsMultiplier;
    score -= carbsPenalty;
    reasons.push("Tinh bột khá nhiều, có thể gây dư năng lượng nếu ăn kèm nhiều món khác");
  }

  // Apply user feedback bonus
  const feedbackBonus = getUserFeedbackBonus(userProfile.id, product.id);
  score += feedbackBonus;

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  let level = "trung bình";
  if (score >= 75) level = "nên ưu tiên";
  else if (score <= 40) level = "nên hạn chế";

  let tip = generatePersonalizedTip(goal, userProfile);

  return {
    score,
    level,
    reasons,
    tip,
    personalization_factors: personalization,
    dynamic_weights: dynamicWeights
  };
}

function getPersonalizationFactors(userProfile) {
  const age = userProfile.age || 30;
  const gender = userProfile.gender || 'male';
  const activityLevel = userProfile.activity_level || 'moderate';
  const bmi = calculateBMI(userProfile.height, userProfile.weight);

  const factors = {
    calorieMultiplier: 1.0,
    proteinMultiplier: 1.0,
    fatMultiplier: 1.0,
    carbsMultiplier: 1.0
  };

  // Age adjustments
  if (age >= 50) {
    factors.calorieMultiplier *= 0.9;
    factors.proteinMultiplier *= 1.1;
  } else if (age <= 25) {
    factors.calorieMultiplier *= 1.1;
  }

  // Gender adjustments
  if (gender === 'male') {
    factors.proteinMultiplier *= 1.15;
    factors.calorieMultiplier *= 1.1;
  } else {
    factors.proteinMultiplier *= 0.9;
    factors.calorieMultiplier *= 0.9;
  }

  // Activity level adjustments
  switch (activityLevel) {
    case 'low':
      factors.calorieMultiplier *= 0.8;
      factors.carbsMultiplier *= 0.7;
      break;
    case 'high':
      factors.calorieMultiplier *= 1.2;
      factors.carbsMultiplier *= 1.3;
      factors.proteinMultiplier *= 1.1;
      break;
    case 'moderate':
    default:
      // baseline
      break;
  }

  // BMI adjustments
  if (bmi >= 25) {
    factors.calorieMultiplier *= 0.85;
    factors.fatMultiplier *= 0.8;
  } else if (bmi < 18.5) {
    factors.calorieMultiplier *= 1.15;
    factors.proteinMultiplier *= 1.1;
  }

  return factors;
}

function getDynamicWeights(userId, productId) {
  const baseWeights = { protein: 1.0, calories: 1.0, fat: 1.0, carbs: 1.0 };
  
  // Get user feedback for this product or similar products
  const userFeedback = getUserFeedback(userId, productId);
  
  if (userFeedback) {
    const rating = userFeedback.rating || 3;
    
    if (rating >= 4) {
      // User likes this type of product
      baseWeights.protein *= 1.1;
      baseWeights.calories *= 1.05;
    } else if (rating <= 2) {
      // User dislikes this type of product
      baseWeights.protein *= 0.9;
      baseWeights.calories *= 0.95;
    }
  }

  return baseWeights;
}

function getUserFeedback(userId, productId) {
  // In real implementation, this would query database
  // For now, return mock data or null
  return null;
}

function getUserFeedbackBonus(userId, productId) {
  const feedback = getUserFeedback(userId, productId);
  if (!feedback) return 0;
  
  const rating = feedback.rating || 3;
  const feedbackCount = feedback.feedback_count || 1;
  
  // Small bonus based on user rating (max +5 points)
  if (rating >= 4 && feedbackCount >= 2) {
    return Math.min((rating - 3) * 2, 5);
  }
  
  return 0;
}

function calculateBMI(height, weight) {
  if (!height || !weight) return 22; // default normal BMI
  const heightInMeters = height / 100;
  return weight / (heightInMeters * heightInMeters);
}

function generatePersonalizedTip(goal, userProfile) {
  const age = userProfile.age || 30;
  const activityLevel = userProfile.activity_level || 'moderate';
  
  if (goal === "weight_loss") {
    if (age >= 50) {
      return "Nếu đang giảm mỡ, bạn nên ưu tiên món có nhiều protein, ít chất béo. Ở độ tuổi này, metabolism chậm lại nên cần kiểm soát calories kỹ hơn.";
    } else if (activityLevel === 'high') {
      return "Nếu đang giảm mỡ và vận động nhiều, bạn cần đủ protein để giữ cơ nhưng không nên cắt quá nhiều carbs để có năng lượng tập luyện.";
    }
    return "Nếu đang giảm mỡ, bạn nên ưu tiên món có nhiều protein, ít chất béo, calories vừa phải và kết hợp nhiều rau.";
  } else if (goal === "weight_gain") {
    if (activityLevel === 'high') {
      return "Nếu đang tăng cơ và vận động nhiều, hãy xem món này như một nguồn đạm và năng lượng, kết hợp thêm tinh bột tốt và đảm bảo đủ calo surplus.";
    }
    return "Nếu đang tăng cơ, hãy xem món này như một nguồn đạm và năng lượng, kết hợp thêm tinh bột tốt như cơm gạo lứt, khoai hoặc yến mạch.";
  } else {
    return "Bạn có thể dùng món này trong bữa ăn bình thường, nhưng vẫn nên cân bằng với rau, trái cây và uống đủ nước.";
  }
}

function recordUserFeedback(userId, productId, rating, comment = '') {
  // In real implementation, this would save to database
  // For now, just log the feedback
  console.log(`User ${userId} rated product ${productId}: ${rating} stars - ${comment}`);
}

function analyzeCartForGoal(items, goal, userProfile = {}) {
  let totalCalories = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    totalCalories += (item.calories || 0) * qty;
    totalProtein += (item.protein || 0) * qty;
    totalFat += (item.fat || 0) * qty;
    totalCarbs += (item.carbs || 0) * qty;
  }

  const personalization = getPersonalizationFactors(userProfile);
  
  // Adjust totals based on personalization
  const adjustedCalories = totalCalories * personalization.calorieMultiplier;
  const adjustedProtein = totalProtein * personalization.proteinMultiplier;

  const summary = {
    totalCalories,
    totalProtein,
    totalFat,
    totalCarbs,
    adjustedCalories,
    adjustedProtein,
    personalization_factors: personalization
  };

  let advice = generatePersonalizedCartAdvice(goal, userProfile, summary);

  return {
    summary,
    advice
  };
}

function generatePersonalizedCartAdvice(goal, userProfile, summary) {
  const age = userProfile.age || 30;
  const activityLevel = userProfile.activity_level || 'moderate';
  const { adjustedCalories, totalProtein } = summary;

  if (goal === "weight_loss") {
    if (activityLevel === 'low') {
      return `Tổng năng lượng ${adjustedCalories.toFixed(0)} calories hơi cao cho mục tiêu giảm mỡ khi vận động ít. Bạn nên ưu tiên các món ít calories nhưng giàu protein như ức gà, sữa chua không đường, cá.`;
    } else if (age >= 50) {
      return `Ở độ tuổi ${age}, metabolism chậm lại. Tổng năng lượng ${adjustedCalories.toFixed(0)} calories cần được kiểm soát. Tăng protein lên ${totalProtein}g để duy trì cơ bắp.`;
    }
    return `Tổng năng lượng này hơi cao cho mục tiêu giảm mỡ nếu bạn không vận động nhiều. Bạn nên ưu tiên các món ít calories nhưng giàu protein.`;
  } else if (goal === "weight_gain") {
    if (activityLevel === 'high') {
      return `Tổng năng lượng ${adjustedCalories.toFixed(0)} calories phù hợp cho tăng cơ với lịch tập cường độ cao. Đảm bảo ${totalProtein}g protein được phân bổ đều các bữa.`;
    }
    return `Tổng năng lượng này có thể phù hợp cho tăng cơ nếu chia đều vào các bữa trong ngày và đi kèm lịch tập đều đặn.`;
  } else {
    return `Bạn nên chú ý tổng lượng calories và cân bằng đủ bốn nhóm chất dưỡng: đạm, tinh bột, chất béo tốt và rau xanh.`;
  }
}

module.exports = {
  analyzeProductForGoal,
  analyzeCartForGoal,
  recordUserFeedback,
  getPersonalizationFactors,
  getDynamicWeights
};
