-- 0002 - Departments, cities and coverage catalog

INSERT INTO departments (code, name) VALUES
    ('FINANCEIRO', N'Financeiro'),
    ('MEDICINA',   N'Medicina'),
    ('SEGURANCA',  N'Segurança');

INSERT INTO cities (code, name) VALUES
    ('ITARARE',     N'Itararé'),
    ('SENGES',      N'Sengés'),
    ('TAQUARITUBA', N'Taquarituba');

INSERT INTO department_cities (department_id, city_id)
SELECT d.id, c.id
FROM (VALUES
    ('FINANCEIRO', 'ITARARE'),
    ('FINANCEIRO', 'SENGES'),
    ('FINANCEIRO', 'TAQUARITUBA'),
    ('MEDICINA',   'ITARARE'),
    ('MEDICINA',   'SENGES'),
    ('SEGURANCA',  'ITARARE'),
    ('SEGURANCA',  'TAQUARITUBA')
) AS coverage (department_code, city_code)
JOIN departments d ON d.code = coverage.department_code
JOIN cities c ON c.code = coverage.city_code;
