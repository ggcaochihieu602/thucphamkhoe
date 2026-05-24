-- Add personalization fields to users table
ALTER TABLE users ADD COLUMN age INT NULL;
ALTER TABLE users ADD COLUMN gender VARCHAR(10) NULL CHECK (gender IN ('male', 'female'));
ALTER TABLE users ADD COLUMN height FLOAT NULL COMMENT 'Chiều cao (cm)';
ALTER TABLE users ADD COLUMN weight FLOAT NULL COMMENT 'Cân nặng (kg)';
ALTER TABLE users ADD COLUMN activity_level VARCHAR(20) NULL CHECK (activity_level IN ('low', 'moderate', 'high'));

-- Create user product feedback table
CREATE TABLE IF NOT EXISTS user_product_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_product (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_product (user_id, product_id),
  INDEX idx_product_rating (product_id, rating),
  INDEX idx_created_at (created_at)
);

-- Create feedback summary view for analytics
CREATE OR REPLACE VIEW product_feedback_summary AS
SELECT 
  p.id as product_id,
  p.name as product_name,
  COUNT(upf.id) as feedback_count,
  AVG(upf.rating) as avg_rating,
  COUNT(CASE WHEN upf.rating >= 4 THEN 1 END) as positive_count,
  COUNT(CASE WHEN upf.rating <= 2 THEN 1 END) as negative_count
FROM products p
LEFT JOIN user_product_feedback upf ON p.id = upf.product_id
GROUP BY p.id, p.name;

-- Add indexes for performance
CREATE INDEX idx_users_age ON users(age);
CREATE INDEX idx_users_gender ON users(gender);
CREATE INDEX idx_users_activity_level ON users(activity_level);
