-- 0001 - Initial schema (Azure SQL Database), web chat channel
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

-- Filled by the intake form. CPF/RG are encrypted by the application
-- (AES-256-GCM, key in Key Vault); cpf_hash is a keyed HMAC used only for lookup.
CREATE TABLE customers (
    id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_customers PRIMARY KEY
                                      CONSTRAINT df_customers_id DEFAULT NEWSEQUENTIALID(),
    full_name        NVARCHAR(150)    NOT NULL,
    phone            VARCHAR(13)      NOT NULL, -- digits only, with country code
    cpf_encrypted    VARBINARY(256)   NOT NULL,
    cpf_hash         BINARY(32)       NOT NULL,
    rg_encrypted     VARBINARY(256)   NOT NULL,
    consent_at       DATETIME2(3)     NOT NULL,
    consent_version  VARCHAR(20)      NOT NULL,
    created_at       DATETIME2(3)     NOT NULL CONSTRAINT df_customers_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_customers_cpf_hash ON customers (cpf_hash);

-- Browser sessions of the web chat. Only the SHA-256 of the token is stored.
CREATE TABLE chat_sessions (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_chat_sessions PRIMARY KEY
                                  CONSTRAINT df_chat_sessions_id DEFAULT NEWSEQUENTIALID(),
    token_hash   BINARY(32)       NOT NULL CONSTRAINT uq_chat_sessions_token UNIQUE,
    customer_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_chat_sessions_customer REFERENCES customers(id),
    created_at   DATETIME2(3)     NOT NULL CONSTRAINT df_chat_sessions_created DEFAULT SYSUTCDATETIME(),
    expires_at   DATETIME2(3)     NOT NULL
);
CREATE INDEX ix_chat_sessions_customer ON chat_sessions (customer_id);

CREATE TABLE tickets (
    id                     UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_tickets PRIMARY KEY
                                            CONSTRAINT df_tickets_id DEFAULT NEWSEQUENTIALID(),
    ticket_number          INT IDENTITY(1000,1) NOT NULL CONSTRAINT uq_tickets_number UNIQUE,
    customer_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_tickets_customer REFERENCES customers(id),
    department_id          INT              NOT NULL CONSTRAINT fk_tickets_department REFERENCES departments(id),
    city_id                INT              NOT NULL CONSTRAINT fk_tickets_city REFERENCES cities(id),
    status                 VARCHAR(20)      NOT NULL CONSTRAINT df_tickets_status DEFAULT 'OPEN',
    assigned_attendant_id  UNIQUEIDENTIFIER NULL CONSTRAINT fk_tickets_attendant REFERENCES attendants(id),
    created_at             DATETIME2(3)     NOT NULL CONSTRAINT df_tickets_created DEFAULT SYSUTCDATETIME(),
    updated_at             DATETIME2(3)     NOT NULL CONSTRAINT df_tickets_updated DEFAULT SYSUTCDATETIME(),
    resolved_at            DATETIME2(3)     NULL,
    CONSTRAINT ck_tickets_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
    CONSTRAINT ck_tickets_resolved CHECK (
        (status = 'RESOLVED' AND resolved_at IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_at IS NULL)),
    -- The pair must be one the catalog serves.
    CONSTRAINT fk_tickets_department_city FOREIGN KEY (department_id, city_id)
        REFERENCES department_cities (department_id, city_id)
);
CREATE INDEX ix_tickets_department_status_created ON tickets (department_id, status, created_at DESC);
CREATE INDEX ix_tickets_status_created ON tickets (status, created_at DESC);
CREATE INDEX ix_tickets_customer ON tickets (customer_id);

-- seq is the polling cursor. client_message_id makes customer posts
-- idempotent: a browser retry returns the message already stored.
CREATE TABLE messages (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_messages PRIMARY KEY
                                          CONSTRAINT df_messages_id DEFAULT NEWSEQUENTIALID(),
    seq                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT uq_messages_seq UNIQUE,
    ticket_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_messages_ticket REFERENCES tickets(id),
    sender               VARCHAR(10)      NOT NULL,
    author_attendant_id  UNIQUEIDENTIFIER NULL CONSTRAINT fk_messages_attendant REFERENCES attendants(id),
    client_message_id    UNIQUEIDENTIFIER NULL,
    body                 NVARCHAR(MAX)    NOT NULL, -- CPFs already masked
    created_at           DATETIME2(3)     NOT NULL CONSTRAINT df_messages_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_messages_sender CHECK (sender IN ('CUSTOMER', 'ATTENDANT', 'SYSTEM')),
    CONSTRAINT ck_messages_author CHECK (
        (sender = 'ATTENDANT' AND author_attendant_id IS NOT NULL) OR (sender <> 'ATTENDANT' AND author_attendant_id IS NULL))
);
CREATE UNIQUE INDEX ux_messages_client_id ON messages (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX ix_messages_ticket_seq ON messages (ticket_id, seq);
