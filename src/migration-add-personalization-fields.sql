-- Migration: Add personalization fields to users table
-- Run this script to add age, gender, height, weight, activity_level columns

-- Add new columns to users table (all nullable, not required for registration)
ALTER TABLE users 
ADD COLUMN age INT NULL COMMENT 'Tuổi người dùng (không bắt buộc)',
ADD COLUMN gender VARCHAR(10) NULL COMMENT 'Giới tính: male, female, other (không bắt buộc)',
ADD COLUMN height FLOAT NULL COMMENT 'Chiều cao cm (không bắt buộc)',
ADD COLUMN weight FLOAT NULL COMMENT 'Cân nặng kg (không bắt buộc)',
ADD COLUMN activity_level VARCHAR(20) NULL COMMENT 'Mức độ vận động: low, moderate, high (không bắt buộc)';

-- Create index for faster queries on personalization fields
CREATE INDEX idx_users_personalization ON users(age, gender, activity_level);

-- Create user_product_feedback table for AI feedback system
CREATE TABLE IF NOT EXISTS user_product_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  rating INT NOT NULL COMMENT 'Rating 1-5',
  comment TEXT NULL COMMENT 'Feedback comment',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_product_feedback (user_id, product_id),
  INDEX idx_product_rating (product_id, rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration completed successfully
-- These fields are now available for users to fill in their profile
