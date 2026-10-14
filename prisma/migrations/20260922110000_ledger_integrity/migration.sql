-- قیود یکپارچگی دفتر: حتی اگر لایهٔ برنامه اشتباه کند، دیتابیس اجازهٔ ثبت نادرست نمی‌دهد.

-- هر ردیف دقیقاً یکی از بدهکار/بستانکار را دارد و مبلغ منفی ممنوع است.
ALTER TABLE "voucher_lines"
  ADD CONSTRAINT "voucher_lines_one_side_chk"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)));

-- ردیف‌های سند قطعی قابل افزودن/ویرایش/حذف نیستند.
CREATE OR REPLACE FUNCTION guard_voucher_lines() RETURNS trigger AS $$
DECLARE st "VoucherStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO st FROM "vouchers" WHERE "id" = OLD."voucherId";
    IF st = 'POSTED' THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: ردیف سند قطعی قابل تغییر نیست';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO st FROM "vouchers" WHERE "id" = NEW."voucherId";
    IF st = 'POSTED' THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: به سند قطعی نمی‌توان ردیف افزود';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER voucher_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "voucher_lines"
  FOR EACH ROW EXECUTE FUNCTION guard_voucher_lines();

-- سند قطعی حذف نمی‌شود و فقط شمارهٔ آن (برای مرتب‌سازی بر اساس تاریخ) قابل تغییر است.
-- هنگام قطعی شدن، تراز بودن و شماره‌دار بودن سند بررسی می‌شود.
CREATE OR REPLACE FUNCTION guard_vouchers() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT; n INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: سند قطعی قابل حذف نیست؛ از سند برگشت استفاده کنید';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'POSTED' THEN
    IF (to_jsonb(NEW) - 'number' - 'dailyNo' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'number' - 'dailyNo' - 'updatedAt') THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: سند قطعی قابل ویرایش نیست';
    END IF;
    IF NEW."number" IS NULL THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: سند قطعی باید شماره داشته باشد';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'POSTED' THEN
    SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
      INTO d, c, n FROM "voucher_lines" WHERE "voucherId" = NEW."id";
    IF n < 2 OR d <> c OR d = 0 THEN
      RAISE EXCEPTION 'LEDGER_UNBALANCED: سند تراز نیست (بدهکار %، بستانکار %)', d, c;
    END IF;
    IF NEW."number" IS NULL THEN
      RAISE EXCEPTION 'LEDGER_INVALID: سند قطعی باید شماره داشته باشد';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vouchers_guard
  BEFORE UPDATE OR DELETE ON "vouchers"
  FOR EACH ROW EXECUTE FUNCTION guard_vouchers();

-- سند نمی‌تواند مستقیم با وضعیت قطعی درج شود (باید اول ردیف‌ها ثبت شوند).
CREATE OR REPLACE FUNCTION guard_voucher_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'POSTED' THEN
    RAISE EXCEPTION 'LEDGER_INVALID: سند باید ابتدا به صورت یادداشت ثبت شود';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vouchers_insert_guard
  BEFORE INSERT ON "vouchers"
  FOR EACH ROW EXECUTE FUNCTION guard_voucher_insert();

-- لاگ ممیزی فقط افزودنی است.
CREATE OR REPLACE FUNCTION guard_audit_log() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: لاگ ممیزی قابل تغییر نیست';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION guard_audit_log();

-- فیلتر مرسوم گزارش‌ها
CREATE INDEX "vouchers_entity_status_date_idx" ON "vouchers" ("entityId", "status", "date");
