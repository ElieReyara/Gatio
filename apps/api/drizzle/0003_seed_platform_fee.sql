-- Règle de frais de départ (roadmap tranche 3, cahier des charges §4) : 4 % + 100 FCFA, portée plateforme.
INSERT INTO fee_rules (scope, scope_id, calc_type, params, currency, valid_from, is_active)
VALUES ('platform', NULL, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now(), true);
