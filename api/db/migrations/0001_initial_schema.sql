-- 0001 - Initial schema (Azure SQL Database)
-- Identifiers in English; reference data in 0002.

CREATE TABLE departments (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_departments PRIMARY KEY,
    code        VARCHAR(30)       NOT NULL CONSTRAINT uq_departments_code UNIQUE,
    name        NVARCHAR(100)     NOT NULL,
    CONSTRAINT ck_departments_code CHECK (code = UPPER(code))
);

CREATE TABLE cities (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_cities PRIMARY KEY,
    code        VARCHAR(30)       NOT NULL CONSTRAINT uq_cities_code UNIQUE,
    name        NVARCHAR(100)     NOT NULL,
    CONSTRAINT ck_cities_code CHECK (code = UPPER(code))
);

-- Which department serves which city (coverage catalog).
CREATE TABLE department_cities (
    department_id INT NOT NULL CONSTRAINT fk_department_cities_department REFERENCES departments(id),
    city_id       INT NOT NULL CONSTRAINT fk_department_cities_city REFERENCES cities(id),
    CONSTRAINT pk_department_cities PRIMARY KEY (department_id, city_id)
);

CREATE TABLE attendants (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_attendants PRIMARY KEY
                                          CONSTRAINT df_attendants_id DEFAULT NEWSEQUENTIALID(),
    identity_provider_id NVARCHAR(200)    NOT NULL CONSTRAINT uq_attendants_identity UNIQUE,
    display_name         NVARCHAR(150)    NOT NULL,
    email                NVARCHAR(254)    NOT NULL CONSTRAINT uq_attendants_email UNIQUE,
    role                 VARCHAR(20)      NOT NULL,
    department_id        INT              NULL CONSTRAINT fk_attendants_department REFERENCES departments(id),
    is_active            BIT              NOT NULL CONSTRAINT df_attendants_active DEFAULT 1,
    created_at           DATETIME2(3)     NOT NULL CONSTRAINT df_attendants_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_attendants_role CHECK (role IN ('ATTENDANT', 'MASTER')),
    -- Every non-master attendant belongs to exactly one department.
    CONSTRAINT ck_attendants_department CHECK (role = 'MASTER' OR department_id IS NOT NULL)
);

-- CPF/RG are encrypted by the application (AES-256-GCM, key in Key Vault).
-- cpf_hash is a keyed HMAC used only for lookup, never the plain value.
CREATE TABLE customers (
    id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_customers PRIMARY KEY
                                      CONSTRAINT df_customers_id DEFAULT NEWSEQUENTIALID(),
    wa_id            VARCHAR(20)      NOT NULL CONSTRAINT uq_customers_wa_id UNIQUE,
    full_name        NVARCHAR(150)    NULL,
    cpf_encrypted    VARBINARY(256)   NULL,
    cpf_hash         BINARY(32)       NULL,
    rg_encrypted     VARBINARY(256)   NULL,
    consent_at       DATETIME2(3)     NULL,
    consent_version  VARCHAR(20)      NULL,
    last_inbound_at  DATETIME2(3)     NULL, -- drives the 24h customer service window
    created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_customers_created DEFAULT SYSUTCDATETIME(),
    updated_at       DATETIME2(3)     NOT NULL CONSTRAINT df_customers_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_customers_consent CHECK (
        (consent_at IS NULL AND consent_version IS NULL) OR (consent_at IS NOT NULL AND consent_version IS NOT NULL))
);
-- Not unique: the same person may write from more than one phone.
CREATE INDEX ix_customers_cpf_hash ON customers (cpf_hash) WHERE cpf_hash IS NOT NULL;

CREATE TABLE tickets (
    id                     UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_tickets PRIMARY KEY
                                            CONSTRAINT df_tickets_id DEFAULT NEWSEQUENTIALID(),
    ticket_number          INT IDENTITY(1000,1) NOT NULL CONSTRAINT uq_tickets_number UNIQUE,
    customer_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_tickets_customer REFERENCES customers(id),
    department_id          INT              NULL CONSTRAINT fk_tickets_department REFERENCES departments(id),
    city_id                INT              NULL CONSTRAINT fk_tickets_city REFERENCES cities(id),
    status                 VARCHAR(20)      NOT NULL CONSTRAINT df_tickets_status DEFAULT 'OPEN',
    classification_source  VARCHAR(10)      NOT NULL CONSTRAINT df_tickets_classification DEFAULT 'NONE',
    -- AUTO: the AI is still triaging; MANUAL: handed to a human (AI failure, not served, too many attempts).
    triage_mode            VARCHAR(10)      NOT NULL CONSTRAINT df_tickets_triage_mode DEFAULT 'AUTO',
    assigned_attendant_id  UNIQUEIDENTIFIER NULL CONSTRAINT fk_tickets_attendant REFERENCES attendants(id),
    created_at             DATETIME2(3)     NOT NULL CONSTRAINT df_tickets_created DEFAULT SYSUTCDATETIME(),
    updated_at             DATETIME2(3)     NOT NULL CONSTRAINT df_tickets_updated DEFAULT SYSUTCDATETIME(),
    resolved_at            DATETIME2(3)     NULL,
    CONSTRAINT ck_tickets_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
    CONSTRAINT ck_tickets_classification CHECK (classification_source IN ('AI', 'HUMAN', 'NONE')),
    CONSTRAINT ck_tickets_triage_mode CHECK (triage_mode IN ('AUTO', 'MANUAL')),
    CONSTRAINT ck_tickets_resolved CHECK (
        (status = 'RESOLVED' AND resolved_at IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_at IS NULL)),
    -- When both are set, the pair must be one the catalog serves.
    CONSTRAINT fk_tickets_department_city FOREIGN KEY (department_id, city_id)
        REFERENCES department_cities (department_id, city_id)
);
CREATE INDEX ix_tickets_department_status_created ON tickets (department_id, status, created_at DESC);
CREATE INDEX ix_tickets_status_created ON tickets (status, created_at DESC);
CREATE INDEX ix_tickets_customer ON tickets (customer_id);

-- wa_message_id is unique: a re-delivered Meta notification fails the insert
-- and is treated as already processed (idempotency).
CREATE TABLE messages (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_messages PRIMARY KEY
                                          CONSTRAINT df_messages_id DEFAULT NEWSEQUENTIALID(),
    ticket_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_messages_ticket REFERENCES tickets(id),
    direction            VARCHAR(10)      NOT NULL,
    wa_message_id        VARCHAR(128)     NULL,
    author_attendant_id  UNIQUEIDENTIFIER NULL CONSTRAINT fk_messages_attendant REFERENCES attendants(id),
    message_type         VARCHAR(20)      NOT NULL,
    template_name        VARCHAR(100)     NULL,
    body                 NVARCHAR(MAX)    NULL, -- WhatsApp texts go up to 4096 chars; CPFs already masked
    sent_at              DATETIME2(3)     NOT NULL,
    processed_at         DATETIME2(3)     NULL, -- inbound only: set once triage/reply finished, so a re-delivery resumes or skips
    created_at           DATETIME2(3)     NOT NULL CONSTRAINT df_messages_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_messages_direction CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_messages_type CHECK (message_type IN ('TEXT', 'TEMPLATE', 'INTERACTIVE', 'OTHER')),
    CONSTRAINT ck_messages_template CHECK (
        (message_type = 'TEMPLATE' AND template_name IS NOT NULL) OR (message_type <> 'TEMPLATE' AND template_name IS NULL)),
    CONSTRAINT ck_messages_author CHECK (direction = 'OUTBOUND' OR author_attendant_id IS NULL)
);
CREATE UNIQUE INDEX ux_messages_wa_message_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX ix_messages_ticket_sent ON messages (ticket_id, sent_at);
