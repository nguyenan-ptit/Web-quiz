-- Identity and waiting rooms, canonical schema; safe to resume interrupted MySQL DDL.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS users (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50)   CHARACTER SET ascii COLLATE ascii_general_ci NULL
                 COMMENT 'NULL với tài khoản khách; server giới hạn [a-z0-9_]',
  email          VARCHAR(254)  NULL,
  password_hash  VARCHAR(255)  NULL COMMENT 'bcrypt; NULL với tài khoản khách',
  display_name   VARCHAR(50)   NOT NULL,
  role           ENUM('USER','ADMIN')     NOT NULL DEFAULT 'USER',
  is_guest       BOOLEAN       NOT NULL DEFAULT FALSE,
  status         ENUM('ACTIVE','LOCKED')  NOT NULL DEFAULT 'ACTIVE',
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_email (email),
  CONSTRAINT ck_users_display_name CHECK (CHAR_LENGTH(TRIM(display_name)) > 0),
  CONSTRAINT ck_users_username_len CHECK (username IS NULL OR CHAR_LENGTH(username) >= 3),
  CONSTRAINT ck_users_account_kind CHECK (
       (is_guest = FALSE AND username IS NOT NULL AND password_hash IS NOT NULL)
    OR (is_guest = TRUE  AND username IS NULL AND email IS NULL
                         AND password_hash IS NULL AND role = 'USER')
  )
) ENGINE=InnoDB COMMENT='Tài khoản thật và tài khoản khách';

CREATE TABLE IF NOT EXISTS user_sessions (
  id            CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id       BIGINT       NOT NULL,
  token_hash    BINARY(32)   NOT NULL COMMENT 'SHA-256 của token ngẫu nhiên; không lưu token thô',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)  NOT NULL,
  revoked_at    DATETIME(3)  NULL,
  last_seen_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sessions_token (token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_sessions_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB COMMENT='Phiên đăng nhập, dùng chung cho REST và socket';

CREATE TABLE IF NOT EXISTS quiz_sets (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  owner_id        BIGINT        NOT NULL,
  title           VARCHAR(200)  NOT NULL,
  description     TEXT          NULL,
  visibility      ENUM('PRIVATE','PUBLIC') NOT NULL DEFAULT 'PRIVATE',
  copied_from_id  BIGINT        NULL COMMENT 'Bộ đề nguồn khi sao chép',
  deleted_at      DATETIME(3)   NULL COMMENT 'Xóa mềm',
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_quiz_sets_owner (owner_id, deleted_at),
  KEY idx_quiz_sets_public (visibility, deleted_at, updated_at),
  KEY idx_quiz_sets_copied (copied_from_id),
  CONSTRAINT fk_quiz_sets_owner  FOREIGN KEY (owner_id)       REFERENCES users (id),
  CONSTRAINT fk_quiz_sets_copied FOREIGN KEY (copied_from_id) REFERENCES quiz_sets (id) ON DELETE SET NULL,
  CONSTRAINT ck_quiz_sets_title CHECK (CHAR_LENGTH(TRIM(title)) > 0)
) ENGINE=InnoDB COMMENT='Bộ đề, thuộc sở hữu của một người dùng';

CREATE TABLE IF NOT EXISTS rooms (
  id                 CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_code          VARCHAR(8)   CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  title              VARCHAR(100) NOT NULL,
  host_user_id       BIGINT       NOT NULL COMMENT 'Chủ phòng hiện tại',
  quiz_set_id        BIGINT       NULL COMMENT 'NULL khi chưa chọn bộ đề',
  visibility         ENUM('PUBLIC','PRIVATE') NOT NULL DEFAULT 'PUBLIC',
  password_hash      VARCHAR(255) NULL COMMENT 'bcrypt; NULL = không đặt mật khẩu',
  max_players        SMALLINT     NOT NULL DEFAULT 20,
  mode               ENUM('SELF_PACED','LIVE') NOT NULL DEFAULT 'SELF_PACED',
  question_time_ms   INT          NOT NULL DEFAULT 30000,
  shuffle_questions  BOOLEAN      NOT NULL DEFAULT TRUE,
  shuffle_choices    BOOLEAN      NOT NULL DEFAULT TRUE,
  streak_bonus       BOOLEAN      NOT NULL DEFAULT FALSE,
  status             ENUM('WAITING','PLAYING','CLOSED') NOT NULL DEFAULT 'WAITING',
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  closed_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rooms_code (room_code),
  KEY idx_rooms_lobby (visibility, status, created_at),
  KEY idx_rooms_host (host_user_id),
  KEY idx_rooms_quiz_set (quiz_set_id),
  CONSTRAINT fk_rooms_host     FOREIGN KEY (host_user_id) REFERENCES users (id),
  CONSTRAINT fk_rooms_quiz_set FOREIGN KEY (quiz_set_id)  REFERENCES quiz_sets (id),
  CONSTRAINT ck_rooms_code     CHECK (CHAR_LENGTH(room_code) = 6),
  CONSTRAINT ck_rooms_title    CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_rooms_players  CHECK (max_players BETWEEN 2 AND 100),
  CONSTRAINT ck_rooms_time     CHECK (question_time_ms BETWEEN 5000 AND 300000),
  CONSTRAINT ck_rooms_closed   CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
) ENGINE=InnoDB COMMENT='Phòng chơi; một phòng có thể tổ chức nhiều trận nối tiếp';

CREATE TABLE IF NOT EXISTS room_members (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  room_id          CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id          BIGINT       NOT NULL,
  display_name     VARCHAR(50)  NOT NULL,
  normalized_name  VARCHAR(50)  COLLATE utf8mb4_0900_as_cs NOT NULL
                   COMMENT 'NFC, trim, gộp khoảng trắng, chữ thường; giữ dấu',
  status           ENUM('JOINED','LEFT','KICKED') NOT NULL DEFAULT 'JOINED',
  joined_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Lần vào gần nhất',
  left_at          DATETIME(3)  NULL,
  active_user_id   BIGINT GENERATED ALWAYS AS (IF(status = 'JOINED', user_id, NULL)) STORED,
  active_name      VARCHAR(50) COLLATE utf8mb4_0900_as_cs
                   GENERATED ALWAYS AS (IF(status = 'JOINED', normalized_name, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_members_room_user  (room_id, user_id),
  UNIQUE KEY uk_members_one_room   (active_user_id),
  UNIQUE KEY uk_members_name       (room_id, active_name),
  KEY idx_members_user (user_id),
  CONSTRAINT fk_members_room FOREIGN KEY (room_id) REFERENCES rooms (id),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_members_name CHECK (CHAR_LENGTH(TRIM(display_name)) > 0),
  CONSTRAINT ck_members_left CHECK ((status = 'JOINED') = (left_at IS NULL))
) ENGINE=InnoDB COMMENT='Thành viên phòng; mỗi tài khoản ở tối đa một phòng tại một thời điểm';

