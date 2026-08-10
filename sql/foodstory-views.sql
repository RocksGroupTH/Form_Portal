-- ============================================================
-- Foodstory views — vw_Foodstory_Clean + vw_Foodstory_Revenue
-- Applied to each brand's Dashboard DB (e.g. Rocks_UNO_Data, Rocks_KSI_Data).
-- The apply-sql script switches USE [<db>] before running this file.
--
-- Clean   = passthrough + cleaned strings + NetSalse derived,
--           filter only unique_order_code IS NOT NULL.
-- Revenue = SELECT * FROM Clean WHERE (not voided) AND (is revenue).
--           Case-insensitive, defensive against NULL/text variants.
-- ============================================================

CREATE OR ALTER VIEW dbo.vw_Foodstory_Clean AS
SELECT
  CAST(Id AS NVARCHAR(32))                          AS Id,
  IngestDate, [time], receipt_no, inv_no, cash_drawer_code,
  NULLIF(LTRIM(RTRIM(menu_code)), '')               AS menu_code,
  NULLIF(LTRIM(RTRIM(menu_name)), '')               AS menu_name,
  NULLIF(LTRIM(RTRIM(order_type)), '')              AS order_type,
  NULLIF(LTRIM(RTRIM(channel)), '')                 AS channel,
  NULLIF(LTRIM(RTRIM(category)), '')                AS category,
  TRY_CAST(quantity AS INT)                         AS quantity_int,
  quantity_num, price_num,
  total_price, discount_value, discounted_price,
  total_price_num, discount_value_num, discounted_price_num,
  -- KEEP THE TYPO: matches Dashboard project so SQL strings port verbatim.
  -- Source `discounted_price` is text; ~8 rows/month have thousand separators
  -- (e.g. "1,425"). REPLACE before TRY_CAST recovers them.
  TRY_CAST(REPLACE(LTRIM(RTRIM(discounted_price)), ',', '') AS DECIMAL(10,2)) AS NetSalse,
  is_non_vat,
  table_name, payment_customer_name,
  -- Strip " Ref ID: …" suffix from payment_type, trim, NULLIF.
  NULLIF(LTRIM(RTRIM(
    LEFT(payment_type,
      CASE WHEN CHARINDEX(' Ref ID:', payment_type) > 0
           THEN CHARINDEX(' Ref ID:', payment_type) - 1
           ELSE LEN(payment_type)
      END)
  )), '')                                           AS payment_type,
  payment_channel, payment_channel_original, custom_payment_ref, remark,
  menu_group_name,
  bill_open_by, bill_close_by,
  NULLIF(LTRIM(RTRIM(branch_name)), '')             AS branch_name,
  NULLIF(LTRIM(RTRIM(branch_id)), '')               AS branch_id,
  CreatedAt, inv_url, order_datetime,
  payment_id, payment_item_id,
  discount_type, discount_by, discount_reason,
  price_with_option, discount_amt,
  void_by, void_reason, void_flag,
  option_name,
  payment_type_original, edc_serial_no, credit_card_id, custompay_name,
  order_type_data, customer_name, is_revenue,
  void_first_name, void_last_name, discount_first_name, discount_last_name,
  promotion_type, is_crm_redeem, unique_order_code
FROM dbo.FS_BillDetail
WHERE unique_order_code IS NOT NULL;
GO

CREATE OR ALTER VIEW dbo.vw_Foodstory_Revenue AS
SELECT *
FROM dbo.vw_Foodstory_Clean
WHERE (void_flag IS NULL OR LOWER(LTRIM(RTRIM(void_flag))) NOT IN ('1','true','y','yes'))
  AND (is_revenue IS NULL OR LOWER(LTRIM(RTRIM(is_revenue))) IN ('1','true','y','yes'));
GO
