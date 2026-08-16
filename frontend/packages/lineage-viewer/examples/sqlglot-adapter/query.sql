SELECT
  user_id,
  SUM(amount) AS total_amount
FROM orders
GROUP BY user_id
