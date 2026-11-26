INSERT INTO flavor_types (id, name, default_fields, sort_order, created_at, updated_at)
SELECT 'type-prop', '小道具', '[]', 5, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM flavor_types WHERE name = '小道具');
