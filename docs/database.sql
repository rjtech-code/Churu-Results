-- PRI Election Management System
-- Fresh-install schema for MySQL 8.x / current MariaDB.
-- Create the database first, then import this file into that database.
-- This file is not an in-place migration for an existing database.

CREATE TABLE districts (
    district_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    district_code VARCHAR(3) NULL COMMENT 'District Code',
    pol_dist_code INT NOT NULL,
    rto_code VARCHAR(4) NOT NULL,
    district_name VARCHAR(150) NULL COMMENT 'District Name',
    district_nameh VARCHAR(250) NOT NULL COMMENT 'District Name (Hindi)',
    state_code VARCHAR(2) NOT NULL COMMENT 'State Code',
    website VARCHAR(50) NOT NULL,
    email_id VARCHAR(50) NOT NULL,
    contact_no VARCHAR(20) NOT NULL,
    PRIMARY KEY (district_id),
    UNIQUE KEY uq_districts_code (district_code),
    KEY idx_districts_name (district_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
    user_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'DISTRICT_HQ_RO', 'OPERATOR', 'PS_RO', 'ZP_RO', 'ZP_ARO') NOT NULL,
    district_id INT UNSIGNED NULL,
    ps_code INT NULL,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_district_role (district_id, role),
    KEY idx_users_ps_code (ps_code),
    CONSTRAINT fk_users_district
        FOREIGN KEY (district_id) REFERENCES districts (district_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE panchayat_samiti (
    id INT NOT NULL AUTO_INCREMENT,
    total_gram INT NOT NULL DEFAULT 0,
    total_wards INT NOT NULL DEFAULT 0,
    ps_code INT NOT NULL,
    gp_code VARCHAR(10) NOT NULL DEFAULT '',
    ps_name VARCHAR(255) NOT NULL,
    ps_nameh VARCHAR(255) NOT NULL,
    district_id INT UNSIGNED NOT NULL,
    no_pollbooth INT NOT NULL DEFAULT 0,
    sno INT NOT NULL DEFAULT 0,
    ps_catg ENUM('UR', 'GEN', 'GEN-F', 'OBC', 'OBC-F', 'SC', 'SC-F', 'ST', 'ST-F') NOT NULL DEFAULT 'UR',
    ero_name VARCHAR(50) NOT NULL DEFAULT '',
    std_code INT NOT NULL DEFAULT 0,
    phone_no INT NOT NULL DEFAULT 0,
    resrv_pollprt INT NOT NULL DEFAULT 0,
    grt1200 INT NOT NULL DEFAULT 0,
    extresrv_pollprt INT NOT NULL DEFAULT 0,
    count_tbl INT NOT NULL DEFAULT 0,
    ext_countprt INT NOT NULL DEFAULT 0,
    aflg INT NOT NULL DEFAULT 0,
    ero_desig VARCHAR(100) NOT NULL DEFAULT '',
    ero_sign VARCHAR(100) NOT NULL DEFAULT '',
    obs_name VARCHAR(100) NOT NULL DEFAULT '',
    obs_mob VARCHAR(20) NOT NULL DEFAULT '',
    veri_code VARCHAR(50) NOT NULL DEFAULT '',
    election_phase INT NOT NULL DEFAULT 0,
    count_date VARCHAR(10) NOT NULL DEFAULT '',
    count_time VARCHAR(10) NOT NULL DEFAULT '',
    g_ps_code INT NOT NULL DEFAULT 0,
    elec_date DATE NOT NULL DEFAULT '1000-01-01',
    poll_TStart VARCHAR(10) NOT NULL DEFAULT '',
    poll_TClose VARCHAR(10) NOT NULL DEFAULT '',
    o_con TINYINT(1) NOT NULL DEFAULT 0,
    r_con TINYINT(1) NOT NULL DEFAULT 0,
    h_con TINYINT(1) NOT NULL DEFAULT 0,
    resrv_ro INT NOT NULL DEFAULT 0,
    req_buevm INT NOT NULL DEFAULT 0,
    req_cuevm INT NOT NULL DEFAULT 0,
    res_buevm INT NOT NULL DEFAULT 0,
    res_cuevm INT NOT NULL DEFAULT 0,
    train_buevm INT NOT NULL DEFAULT 0,
    train_cuevm INT NOT NULL DEFAULT 0,
    jp_date DATE NOT NULL DEFAULT '1000-01-01',
    ps_date DATE NOT NULL DEFAULT '1000-01-01',
    ro_name VARCHAR(100) NOT NULL DEFAULT '',
    ro_desig VARCHAR(100) NOT NULL DEFAULT '',
    ro_sign VARCHAR(100) NOT NULL DEFAULT '',
    postal_count_tbl INT NOT NULL DEFAULT 0,
    postal_ext_countprt INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_panchayat_samiti_code (ps_code),
    UNIQUE KEY uq_panchayat_samiti_code_district (ps_code, district_id),
    KEY idx_panchayat_samiti_district (district_id),
    KEY idx_panchayat_samiti_name (ps_name),
    CONSTRAINT fk_panchayat_samiti_district
        FOREIGN KEY (district_id) REFERENCES districts (district_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE zila_parishad (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    total_gram INT UNSIGNED NOT NULL DEFAULT 0,
    total_ps INT UNSIGNED NOT NULL DEFAULT 0,
    zp_code INT UNSIGNED NOT NULL,
    toal_ward INT UNSIGNED NOT NULL DEFAULT 0,
    zp_name VARCHAR(255) NOT NULL,
    zp_nameh VARCHAR(255) NOT NULL,
    district_id INT UNSIGNED NOT NULL,
    no_pollbooth INT UNSIGNED NOT NULL DEFAULT 0,
    sno INT UNSIGNED NOT NULL DEFAULT 0,
    zp_catg ENUM('UR', 'GEN', 'GEN-F', 'OBC', 'OBC-F', 'SC', 'SC-F', 'ST', 'ST-F') NOT NULL,
    ero_name VARCHAR(50) NOT NULL,
    std_code VARCHAR(10) NOT NULL,
    phone_no VARCHAR(20) NOT NULL,
    resrv_pollprt INT UNSIGNED NOT NULL DEFAULT 0,
    grt1200 TINYINT(1) NOT NULL DEFAULT 0,
    extresrv_pollprt INT UNSIGNED NOT NULL DEFAULT 0,
    count_tbl INT UNSIGNED NOT NULL DEFAULT 0,
    ext_countprt INT UNSIGNED NOT NULL DEFAULT 0,
    aflg TINYINT(1) NOT NULL DEFAULT 0,
    ero_desig VARCHAR(100) NOT NULL,
    ero_sign VARCHAR(100) NOT NULL,
    obs_name VARCHAR(100) NOT NULL,
    obs_mob VARCHAR(20) NOT NULL,
    veri_code VARCHAR(50) NOT NULL,
    election_phase INT UNSIGNED NOT NULL DEFAULT 0,
    count_date VARCHAR(10) NOT NULL,
    count_time VARCHAR(10) NOT NULL,
    g_zp_code INT UNSIGNED NOT NULL,
    elec_date DATE NOT NULL,
    poll_TStart VARCHAR(10) NOT NULL,
    poll_TClose VARCHAR(10) NOT NULL,
    o_con TINYINT(1) NOT NULL DEFAULT 0,
    r_con TINYINT(1) NOT NULL DEFAULT 0,
    h_con TINYINT(1) NOT NULL DEFAULT 0,
    resrv_ro INT UNSIGNED NOT NULL DEFAULT 0,
    req_buevm INT UNSIGNED NOT NULL DEFAULT 0,
    req_cuevm INT UNSIGNED NOT NULL DEFAULT 0,
    res_buevm INT UNSIGNED NOT NULL DEFAULT 0,
    res_cuevm INT UNSIGNED NOT NULL DEFAULT 0,
    train_buevm INT UNSIGNED NOT NULL DEFAULT 0,
    train_cuevm INT UNSIGNED NOT NULL DEFAULT 0,
    jp_date DATE NOT NULL,
    zp_date DATE NOT NULL,
    ro_name VARCHAR(100) NOT NULL,
    ro_desig VARCHAR(100) NOT NULL,
    ro_sign VARCHAR(100) NOT NULL,
    postal_count_tbl INT UNSIGNED NOT NULL DEFAULT 0,
    postal_ext_countprt INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_zila_parishad_zp_code (zp_code),
    UNIQUE KEY uq_zila_parishad_code_district (zp_code, district_id),
    KEY idx_zila_parishad_district (district_id),
    KEY idx_zila_parishad_district_sno (district_id, sno),
    CONSTRAINT fk_zila_parishad_district
        FOREIGN KEY (district_id) REFERENCES districts (district_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_zila_parishad_flags CHECK (
        grt1200 IN (0, 1)
        AND aflg IN (0, 1)
        AND o_con IN (0, 1)
        AND r_con IN (0, 1)
        AND h_con IN (0, 1)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE grampanchayat (
    p_id INT NOT NULL,
    gp_number INT NOT NULL,
    gp_name VARCHAR(150) NOT NULL,
    gp_nameh VARCHAR(255) NOT NULL,
    ps_code INT NOT NULL,
    district_id INT UNSIGNED NOT NULL,
    ward_no VARCHAR(255) NOT NULL COMMENT 'Total number of wards in the Gram Panchayat',
    tot_pstn INT NOT NULL COMMENT 'Total polling stations in the Gram Panchayat',
    n_ps_code INT NOT NULL,
    n_gp_code INT NOT NULL,
    election_phase INT NOT NULL,
    election_date DATE NULL COMMENT 'Election date for Gram Panchayat wards and Sarpanch election',
    nomPlacenm VARCHAR(255) NULL,
    PRIMARY KEY (p_id),
    UNIQUE KEY uq_grampanchayat_id_ps_code (p_id, ps_code),
    KEY idx_grampanchayat_ps_district (ps_code, district_id),
    KEY idx_grampanchayat_district (district_id),
    CONSTRAINT fk_grampanchayat_panchayat_samiti
        FOREIGN KEY (ps_code, district_id)
        REFERENCES panchayat_samiti (ps_code, district_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_grampanchayat_district
        FOREIGN KEY (district_id) REFERENCES districts (district_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
    ADD CONSTRAINT fk_users_panchayat_samiti
        FOREIGN KEY (ps_code) REFERENCES panchayat_samiti (ps_code)
        ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE mst_symbol (
    symbol_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    symbol_code VARCHAR(30) NOT NULL,
    symbol_name VARCHAR(120) NOT NULL,
    symbol_image VARCHAR(255) NULL,
    is_free_symbol TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol_id),
    UNIQUE KEY uq_mst_symbol_code (symbol_code),
    CONSTRAINT chk_mst_symbol_free_flag CHECK (is_free_symbol IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE political_parties (
    party_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    party_code VARCHAR(30) NOT NULL,
    party_name VARCHAR(150) NOT NULL,
    party_nameh VARCHAR(200) NOT NULL,
    party_type VARCHAR(40) NOT NULL,
    display_order TINYINT UNSIGNED NOT NULL COMMENT '1=recognized national/state; 2=registered unrecognized; independents use 3 at ballot generation',
    reserved_symbol_id INT UNSIGNED NULL,
    PRIMARY KEY (party_id),
    UNIQUE KEY uq_political_parties_code (party_code),
    KEY idx_political_parties_ballot_order (display_order, party_nameh),
    KEY idx_political_parties_reserved_symbol (reserved_symbol_id),
    CONSTRAINT chk_political_parties_display_order CHECK (display_order IN (1, 2)),
    CONSTRAINT fk_political_parties_reserved_symbol
        FOREIGN KEY (reserved_symbol_id) REFERENCES mst_symbol (symbol_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mst_control_unit (
    cu_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    cu_serial_no VARCHAR(100) NOT NULL,
    manufacturer ENUM('BEL', 'ECIL') NOT NULL,
    evm_type VARCHAR(20) NOT NULL COMMENT 'e.g., M2, M3',
    `DMM` VARCHAR(50) NOT NULL COMMENT 'DMM tracking/marking details',
    status ENUM('AVAILABLE', 'ALLOTTED', 'DEFECTIVE', 'RESERVE') NOT NULL DEFAULT 'AVAILABLE',
    PRIMARY KEY (cu_id),
    UNIQUE KEY uq_control_unit_serial (cu_serial_no),
    KEY idx_control_unit_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mst_ballot_unit (
    bu_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    bu_serial_no VARCHAR(100) NOT NULL,
    manufacturer ENUM('BEL', 'ECIL') NOT NULL,
    evm_type VARCHAR(20) NOT NULL COMMENT 'e.g., M2, M3',
    candidate_capacity INT UNSIGNED NOT NULL DEFAULT 16 COMMENT 'Total number of candidates this BU can cater for',
    status ENUM('AVAILABLE', 'ALLOTTED', 'DEFECTIVE', 'RESERVE') NOT NULL DEFAULT 'AVAILABLE',
    PRIMARY KEY (bu_id),
    UNIQUE KEY uq_ballot_unit_serial (bu_serial_no),
    KEY idx_ballot_unit_status (status),
    CONSTRAINT chk_ballot_unit_candidate_capacity CHECK (candidate_capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wards (
    ward_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ward_type ENUM('PANCHAYAT_SAMITI', 'ZILA_PARISHAD', 'GRAM_PANCHAYAT') NOT NULL,
    ps_code INT NULL,
    zp_code INT UNSIGNED NULL,
    gp_code INT NULL,
    ward_no SMALLINT UNSIGNED NOT NULL,
    reservation_category VARCHAR(40) NOT NULL,
    male_voters INT UNSIGNED NOT NULL DEFAULT 0,
    female_voters INT UNSIGNED NOT NULL DEFAULT 0,
    tg_voters INT UNSIGNED NOT NULL DEFAULT 0,
    total_booths SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    data_status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    winning_candidate_id INT UNSIGNED NULL,
    assigned_hq_officer_id INT UNSIGNED NULL,
    PRIMARY KEY (ward_id),
    UNIQUE KEY uq_wards_id_ps_code (ward_id, ps_code),
    UNIQUE KEY uq_wards_id_zp_code (ward_id, zp_code),
    UNIQUE KEY uq_wards_id_type (ward_id, ward_type),
    UNIQUE KEY uq_wards_ps_number (ps_code, ward_type, ward_no),
    UNIQUE KEY uq_wards_gp_number (gp_code, ward_no),
    UNIQUE KEY uq_wards_zp_number (zp_code, ward_no),
    KEY idx_wards_ps_type (ps_code, ward_type),
    KEY idx_wards_zp_type (zp_code, ward_type),
    KEY idx_wards_gp_ps_code (gp_code, ps_code),
    KEY idx_wards_hq_officer (assigned_hq_officer_id),
    CONSTRAINT fk_wards_panchayat_samiti
        FOREIGN KEY (ps_code) REFERENCES panchayat_samiti (ps_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wards_zila_parishad
        FOREIGN KEY (zp_code) REFERENCES zila_parishad (zp_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wards_grampanchayat_ps
        FOREIGN KEY (gp_code, ps_code) REFERENCES grampanchayat (p_id, ps_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wards_hq_officer
        FOREIGN KEY (assigned_hq_officer_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE candidates (
    candidate_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ward_id INT UNSIGNED NOT NULL,
    party_id INT UNSIGNED NULL,
    symbol_id INT UNSIGNED NULL,
    candidate_name VARCHAR(150) NOT NULL,
    candidate_nameh VARCHAR(255) NOT NULL COMMENT 'Used for Hindi alphabetical Form 7A ordering',
    age TINYINT UNSIGNED NOT NULL,
    gender VARCHAR(20) NOT NULL,
    nomination_status ENUM(
        'SUBMITTED',
        'ACCEPTED_SCRUTINY',
        'REJECTED_SCRUTINY',
        'WITHDRAWN',
        'CONTESTING'
    ) NOT NULL DEFAULT 'SUBMITTED',
    PRIMARY KEY (candidate_id),
    UNIQUE KEY uq_candidates_candidate_ward (candidate_id, ward_id),
    KEY idx_candidates_ward_status (ward_id, nomination_status),
    KEY idx_candidates_party (party_id),
    KEY idx_candidates_symbol (symbol_id),
    KEY idx_candidates_ward_hindi_name (ward_id, candidate_nameh),
    CONSTRAINT fk_candidates_ward
        FOREIGN KEY (ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_candidates_party
        FOREIGN KEY (party_id) REFERENCES political_parties (party_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_candidates_symbol
        FOREIGN KEY (symbol_id) REFERENCES mst_symbol (symbol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE direct_nominations (
    nomination_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contest_type ENUM(
        'GRAM_PANCHAYAT_MEMBER',
        'PANCHAYAT_SAMITI_MEMBER',
        'ZILA_PARISHAD_MEMBER',
        'SARPANCH'
    ) NOT NULL,
    ward_id INT UNSIGNED NULL COMMENT 'Set for ward-member nominations; NULL for Sarpanch',
    gp_code INT NULL COMMENT 'Set for Sarpanch nominations; ward-member GP is derived from wards.gp_code',
    candidate_id INT UNSIGNED NULL COMMENT 'Links a ward-member nomination to its ballot candidate; NULL for Sarpanch',
    candidate_name VARCHAR(150) NOT NULL,
    candidate_nameh VARCHAR(255) NOT NULL,
    age TINYINT UNSIGNED NOT NULL,
    gender VARCHAR(20) NOT NULL,
    party_id INT UNSIGNED NULL,
    symbol_id INT UNSIGNED NULL,
    nomination_status ENUM(
        'SUBMITTED',
        'ACCEPTED_SCRUTINY',
        'REJECTED_SCRUTINY',
        'WITHDRAWN',
        'CONTESTING'
    ) NOT NULL DEFAULT 'SUBMITTED',
    submitted_by INT UNSIGNED NOT NULL,
    reviewed_by INT UNSIGNED NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (nomination_id),
    UNIQUE KEY uq_direct_nomination_candidate (candidate_id),
    KEY idx_direct_nomination_ward_status (ward_id, nomination_status),
    KEY idx_direct_nomination_gp_status (gp_code, nomination_status),
    KEY idx_direct_nomination_contest_status (contest_type, nomination_status),
    KEY idx_direct_nomination_party (party_id),
    KEY idx_direct_nomination_symbol (symbol_id),
    KEY idx_direct_nomination_submitted_by (submitted_by),
    KEY idx_direct_nomination_reviewed_by (reviewed_by),
    CONSTRAINT fk_direct_nomination_ward
        FOREIGN KEY (ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_gp
        FOREIGN KEY (gp_code) REFERENCES grampanchayat (p_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_candidate_ward
        FOREIGN KEY (candidate_id, ward_id) REFERENCES candidates (candidate_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_party
        FOREIGN KEY (party_id) REFERENCES political_parties (party_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_symbol
        FOREIGN KEY (symbol_id) REFERENCES mst_symbol (symbol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_submitter
        FOREIGN KEY (submitted_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_direct_nomination_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE wards
    ADD KEY idx_wards_winning_candidate_ward (winning_candidate_id, ward_id),
    ADD CONSTRAINT fk_wards_winning_candidate_ward
        FOREIGN KEY (winning_candidate_id, ward_id)
        REFERENCES candidates (candidate_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE ward_ballots_master (
    ballot_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ward_id INT UNSIGNED NOT NULL,
    locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by_user INT UNSIGNED NOT NULL,
    PRIMARY KEY (ballot_id),
    UNIQUE KEY uq_ward_ballots_master_ward (ward_id),
    UNIQUE KEY uq_ward_ballots_master_ballot_ward (ballot_id, ward_id),
    KEY idx_ward_ballots_locked_by (locked_by_user),
    CONSTRAINT fk_ward_ballots_ward
        FOREIGN KEY (ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_ward_ballots_locked_by
        FOREIGN KEY (locked_by_user) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE wards
    ADD COLUMN ballot_id INT UNSIGNED DEFAULT NULL
        COMMENT 'FK to ward_ballots_master. Set when RO locks the ballot.',
    ADD KEY idx_wards_ballot_id_ward (ballot_id, ward_id),
    ADD CONSTRAINT fk_wards_ballot_master
        FOREIGN KEY (ballot_id, ward_id)
        REFERENCES ward_ballots_master (ballot_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE ward_ballot_layout (
    layout_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ballot_id INT UNSIGNED NOT NULL,
    ballot_position INT UNSIGNED NOT NULL,
    candidate_id INT UNSIGNED NULL COMMENT 'NULL only for the NOTA ballot button',
    printed_name_en VARCHAR(150) NOT NULL COMMENT 'Immutable text snapshot printed on the ballot',
    printed_name_hi VARCHAR(255) NOT NULL,
    printed_party VARCHAR(200) NOT NULL,
    printed_party_hi VARCHAR(200) NOT NULL,
    symbol_id INT UNSIGNED NOT NULL,
    printed_symbol_name VARCHAR(120) NOT NULL,
    printed_symbol_image VARCHAR(255) NULL,
    is_nota TINYINT(1) NOT NULL DEFAULT 0,
    nota_key TINYINT UNSIGNED NULL COMMENT 'Set to 1 for NOTA, NULL for candidate rows; unique per ballot',
    PRIMARY KEY (layout_id),
    UNIQUE KEY uq_ballot_button (ballot_id, ballot_position),
    UNIQUE KEY uq_ballot_candidate (ballot_id, candidate_id),
    UNIQUE KEY uq_ballot_single_nota (ballot_id, nota_key),
    UNIQUE KEY uq_ballot_layout_id_ballot (layout_id, ballot_id),
    KEY idx_ballot_layout_ballot_order (ballot_id, ballot_position),
    KEY idx_ballot_layout_candidate (candidate_id),
    KEY idx_ballot_symbol (symbol_id),
    CONSTRAINT chk_ballot_nota_flag CHECK (
        (is_nota = 1 AND nota_key = 1)
        OR (is_nota = 0 AND nota_key IS NULL)
    ),
    CONSTRAINT fk_ballot_layout_master
        FOREIGN KEY (ballot_id) REFERENCES ward_ballots_master (ballot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_ballot_candidate
        FOREIGN KEY (candidate_id) REFERENCES candidates (candidate_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_ballot_symbol
        FOREIGN KEY (symbol_id) REFERENCES mst_symbol (symbol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mstpolstn (
    pstn_id INT NOT NULL AUTO_INCREMENT COMMENT 'Auto unique increment id',
    pc_code VARCHAR(2) NOT NULL DEFAULT '',
    ac_code VARCHAR(3) NULL,
    district_code INT NOT NULL DEFAULT 0,
    tehsil_code VARCHAR(10) NOT NULL DEFAULT '',
    party_code VARCHAR(5) NOT NULL DEFAULT '',
    pstn_code VARCHAR(6) NULL,
    pstn_name VARCHAR(50) NULL,
    pstn_nameh VARCHAR(200) NULL,
    pbldg_name VARCHAR(200) NULL,
    pbldg_nameh VARCHAR(255) NOT NULL DEFAULT '',
    pbldg_type VARCHAR(5) NULL,
    pstn_areah VARCHAR(255) NOT NULL DEFAULT '',
    pstn_type ENUM('A', 'M', 'F', '') DEFAULT 'A',
    critical_sensitive ENUM('O', 'C', 'S', 'H') DEFAULT 'O',
    critical_type ENUM('S1', 'S2', 'S3', 'S4') NULL,
    thana_code INT NOT NULL DEFAULT 0,
    area_code VARCHAR(2) NULL,
    zone_code VARCHAR(5) NULL,
    booth_asstt_centre CHAR(1) NOT NULL DEFAULT '',
    no_of_voters INT NULL,
    flag TINYINT(1) NOT NULL DEFAULT 0,
    active BIT(1) NOT NULL DEFAULT b'0',
    ru VARCHAR(1) NOT NULL DEFAULT 'r',
    mo_flag TINYINT(1) NOT NULL DEFAULT 0,
    mo_mark ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    wc_mark ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    vo_flag TINYINT(1) NOT NULL DEFAULT 0,
    vo_mark ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    wc_flag TINYINT(1) NOT NULL DEFAULT 0,
    txt_veh VARCHAR(15) NOT NULL DEFAULT '',
    female_flag ENUM('Y', 'N', 'M') NOT NULL DEFAULT 'N',
    booth_assi_flag ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    route_id INT NOT NULL DEFAULT 0,
    route_chart_id INT NOT NULL DEFAULT 0,
    act_male INT NOT NULL DEFAULT 0,
    act_female INT NOT NULL DEFAULT 0,
    act_others INT NOT NULL DEFAULT 0,
    ind ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    rpt_mo VARCHAR(10) NOT NULL DEFAULT '',
    rpt_wc VARCHAR(10) NOT NULL DEFAULT '',
    ind_vo ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    ind_wc ENUM('Y', 'N') NOT NULL DEFAULT 'N',
    rpt_vo VARCHAR(10) NOT NULL DEFAULT '',
    police_detail VARCHAR(500) NOT NULL DEFAULT '',
    ward_no INT NOT NULL DEFAULT 0,
    lb_code VARCHAR(20) NOT NULL DEFAULT '',
    old_pstn VARCHAR(10) NOT NULL DEFAULT '',
    bhag_no VARCHAR(10) NOT NULL DEFAULT '',
    ps_ward_no VARCHAR(100) NOT NULL DEFAULT '',
    gram_panchyat INT NOT NULL,
    ps_code INT NOT NULL,
    n_ps_code INT NOT NULL DEFAULT 0,
    n_pstn_code VARCHAR(5) NOT NULL DEFAULT '',
    n_gram_panchyat INT NOT NULL DEFAULT 0,
    zp_ward_no VARCHAR(100) NOT NULL DEFAULT '',
    gp_ward_no VARCHAR(100) NOT NULL DEFAULT '',
    so_no VARCHAR(100) NOT NULL DEFAULT '',
    so_nameh VARCHAR(100) NOT NULL DEFAULT '',
    so_mob VARCHAR(20) NOT NULL DEFAULT '',
    blo_nameh VARCHAR(100) NOT NULL DEFAULT '',
    blo_mob VARCHAR(20) NOT NULL DEFAULT '',
    zp_code INT UNSIGNED NULL,
    ps_ward_id INT UNSIGNED NULL,
    zp_ward_id INT UNSIGNED NULL,
    PRIMARY KEY (pstn_id),
    KEY idx_mstpolstn_ps_code (ps_code),
    KEY idx_mstpolstn_zp_code (zp_code),
    KEY idx_mstpolstn_gp_ps (gram_panchyat, ps_code),
    KEY idx_mstpolstn_ps_ward (ps_ward_id),
    KEY idx_mstpolstn_zp_ward (zp_ward_id),
    CONSTRAINT fk_mstpolstn_panchayat_samiti
        FOREIGN KEY (ps_code) REFERENCES panchayat_samiti (ps_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_mstpolstn_zila_parishad
        FOREIGN KEY (zp_code) REFERENCES zila_parishad (zp_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_mstpolstn_grampanchayat_ps
        FOREIGN KEY (gram_panchyat) REFERENCES grampanchayat (p_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_mstpolstn_ps_ward
        FOREIGN KEY (ps_ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_mstpolstn_zp_ward
        FOREIGN KEY (zp_ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pstn_evm_allocation (
    allocation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pstn_id INT NOT NULL,
    ballot_for ENUM('PS', 'ZP') NOT NULL,
    unit_type ENUM('CU', 'BU') NOT NULL,
    cu_id INT UNSIGNED NULL,
    bu_id INT UNSIGNED NULL,
    cu_is_present TINYINT AS (cu_id IS NOT NULL) STORED,
    bu_is_present TINYINT AS (bu_id IS NOT NULL) STORED,
    deployment_stage ENUM('ORIGINAL', 'REPLACED_MOCK_POLL', 'REPLACED_DURING_POLL') NOT NULL,
    is_active_counting TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (allocation_id),
    KEY idx_pstn_evm_allocation_booth_election (pstn_id, ballot_for, is_active_counting),
    KEY idx_pstn_evm_allocation_cu (cu_id),
    KEY idx_pstn_evm_allocation_bu (bu_id),
    CONSTRAINT chk_pstn_evm_allocation_unit CHECK (
        (unit_type = 'CU' AND cu_is_present = 1 AND bu_is_present = 0)
        OR (unit_type = 'BU' AND bu_is_present = 1 AND cu_is_present = 0)
    ),
    CONSTRAINT chk_pstn_evm_allocation_active CHECK (is_active_counting IN (0, 1)),
    CONSTRAINT fk_pstn_evm_allocation_station
        FOREIGN KEY (pstn_id) REFERENCES mstpolstn (pstn_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_pstn_evm_allocation_cu
        FOREIGN KEY (cu_id) REFERENCES mst_control_unit (cu_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_pstn_evm_allocation_bu
        FOREIGN KEY (bu_id) REFERENCES mst_ballot_unit (bu_id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE booth_counting_entry (
    entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pstn_id INT NOT NULL,
    round_no SMALLINT UNSIGNED NOT NULL,
    status_ps ENUM('DRAFT', 'SUBMITTED_TO_RO', 'VERIFIED_BY_RO', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    ps_verified_by INT UNSIGNED NULL,
    status_zp ENUM('DRAFT', 'SUBMITTED_TO_LOCAL_RO', 'FORWARDED_TO_HQ', 'VERIFIED_BY_HQ', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    hq_verified_by INT UNSIGNED NULL,
    entered_by INT UNSIGNED NOT NULL,
    PRIMARY KEY (entry_id),
    UNIQUE KEY uq_counting_entry_booth_round (pstn_id, round_no),
    UNIQUE KEY uq_counting_entry_id_pstn (entry_id, pstn_id),
    KEY idx_counting_entry_ps_status (status_ps),
    KEY idx_counting_entry_zp_status (status_zp),
    KEY idx_counting_entry_ps_verifier (ps_verified_by),
    KEY idx_counting_entry_hq_verifier (hq_verified_by),
    KEY idx_counting_entry_entered_by (entered_by),
    CONSTRAINT fk_counting_entry_booth
        FOREIGN KEY (pstn_id) REFERENCES mstpolstn (pstn_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_counting_entry_ps_verifier
        FOREIGN KEY (ps_verified_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_counting_entry_hq_verifier
        FOREIGN KEY (hq_verified_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_counting_entry_entered_by
        FOREIGN KEY (entered_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE booth_candidate_votes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entry_id BIGINT UNSIGNED NOT NULL,
    pstn_id INT NOT NULL,
    ward_id INT UNSIGNED NOT NULL,
    ballot_id INT UNSIGNED NOT NULL,
    layout_id INT UNSIGNED NOT NULL,
    votes_secured INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_booth_ballot_vote (entry_id, ward_id, layout_id),
    KEY idx_booth_votes_entry_pstn (entry_id, pstn_id),
    KEY idx_booth_votes_ward (ward_id),
    KEY idx_booth_votes_ballot_ward (ballot_id, ward_id),
    KEY idx_booth_votes_layout_ballot (layout_id, ballot_id),
    CONSTRAINT fk_booth_votes_entry_booth
        FOREIGN KEY (entry_id, pstn_id)
        REFERENCES booth_counting_entry (entry_id, pstn_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_booth_votes_ward
        FOREIGN KEY (ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_booth_votes_master_ward
        FOREIGN KEY (ballot_id, ward_id)
        REFERENCES ward_ballots_master (ballot_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_booth_votes_layout_ballot
        FOREIGN KEY (layout_id, ballot_id)
        REFERENCES ward_ballot_layout (layout_id, ballot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE postal_ballot_votes (
    postal_vote_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ward_id INT UNSIGNED NOT NULL,
    ward_type ENUM('PANCHAYAT_SAMITI', 'ZILA_PARISHAD') NOT NULL,
    ballot_id INT UNSIGNED NOT NULL,
    layout_id INT UNSIGNED NOT NULL,
    votes_secured INT UNSIGNED NOT NULL DEFAULT 0,
    entered_by INT UNSIGNED NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (postal_vote_id),
    UNIQUE KEY uq_postal_vote_layout (ward_id, layout_id),
    KEY idx_postal_vote_ballot_ward (ballot_id, ward_id),
    KEY idx_postal_vote_layout_ballot (layout_id, ballot_id),
    KEY idx_postal_vote_entered_by (entered_by),
    CONSTRAINT fk_postal_vote_ward_type
        FOREIGN KEY (ward_id, ward_type) REFERENCES wards (ward_id, ward_type)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_postal_vote_ballot_ward
        FOREIGN KEY (ballot_id, ward_id) REFERENCES ward_ballots_master (ballot_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_postal_vote_layout_ballot
        FOREIGN KEY (layout_id, ballot_id) REFERENCES ward_ballot_layout (layout_id, ballot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_postal_vote_user
        FOREIGN KEY (entered_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE indirect_elections (
    ie_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    body_type VARCHAR(40) NOT NULL,
    ps_code INT NOT NULL,
    election_post VARCHAR(100) NOT NULL,
    nomination_date DATE NOT NULL,
    poll_date DATE NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
    ro_user_id INT UNSIGNED NOT NULL,
    valid_votes INT UNSIGNED NOT NULL DEFAULT 0,
    invalid_votes INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (ie_id),
    KEY idx_indirect_elections_ps_code (ps_code),
    KEY idx_indirect_elections_ro (ro_user_id),
    CONSTRAINT fk_indirect_elections_panchayat_samiti
        FOREIGN KEY (ps_code) REFERENCES panchayat_samiti (ps_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_elections_ro
        FOREIGN KEY (ro_user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE indirect_electoral_roll (
    roll_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ie_id INT UNSIGNED NOT NULL,
    ward_id INT UNSIGNED NOT NULL,
    member_candidate_id INT UNSIGNED NOT NULL,
    is_present TINYINT(1) NOT NULL DEFAULT 0,
    has_voted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (roll_id),
    UNIQUE KEY uq_indirect_roll_member (ie_id, member_candidate_id),
    KEY idx_indirect_roll_ward (ward_id),
    KEY idx_indirect_roll_member_ward (member_candidate_id, ward_id),
    CONSTRAINT fk_indirect_roll_election
        FOREIGN KEY (ie_id) REFERENCES indirect_elections (ie_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_roll_ward
        FOREIGN KEY (ward_id) REFERENCES wards (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_roll_member
        FOREIGN KEY (member_candidate_id, ward_id)
        REFERENCES candidates (candidate_id, ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE indirect_nominations (
    nom_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ie_id INT UNSIGNED NOT NULL,
    candidate_id INT UNSIGNED NOT NULL,
    proposer_candidate_id INT UNSIGNED NOT NULL,
    seconder_candidate_id INT UNSIGNED NOT NULL,
    nom_status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
    votes_secured INT UNSIGNED NOT NULL DEFAULT 0,
    is_winner TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (nom_id),
    UNIQUE KEY uq_indirect_nominee (ie_id, candidate_id),
    KEY idx_indirect_nom_proposer (proposer_candidate_id),
    KEY idx_indirect_nom_seconder (seconder_candidate_id),
    CONSTRAINT fk_indirect_nomination_election
        FOREIGN KEY (ie_id) REFERENCES indirect_elections (ie_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_nomination_candidate
        FOREIGN KEY (candidate_id) REFERENCES candidates (candidate_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_nomination_proposer
        FOREIGN KEY (proposer_candidate_id) REFERENCES candidates (candidate_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_indirect_nomination_seconder
        FOREIGN KEY (seconder_candidate_id) REFERENCES candidates (candidate_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTA must use a configured symbol so the ballot row always has a valid symbol FK.
INSERT INTO mst_symbol (symbol_code, symbol_name, symbol_image, is_free_symbol)
VALUES ('NOTA', 'NOTA', NULL, 1);

CREATE OR REPLACE
    ALGORITHM = UNDEFINED
    SQL SECURITY INVOKER
VIEW vw_candidate_live_tallies AS
SELECT
    bl.ballot_id,
    bl.layout_id,
    bm.ward_id,
    bl.candidate_id,
    c.party_id,
    p.party_name,
    p.party_nameh,
    bl.symbol_id,
    bl.printed_symbol_name AS symbol_name,
    bl.printed_symbol_image AS symbol_image,
    bl.ballot_position,
    bl.printed_name_en AS candidate_name,
    bl.printed_name_hi AS candidate_nameh,
    bl.is_nota,
    CASE WHEN bl.is_nota = 1 THEN 'NOTA' ELSE c.nomination_status END AS nomination_status,
    COALESCE(SUM(
        CASE WHEN bce.entry_id IS NOT NULL THEN bcv.votes_secured ELSE 0 END
    ), 0) + COALESCE((
        SELECT SUM(pbv.votes_secured)
        FROM postal_ballot_votes AS pbv
        WHERE pbv.layout_id = bl.layout_id
          AND pbv.ballot_id = bl.ballot_id
          AND pbv.ward_id = bm.ward_id
    ), 0) AS total_votes,
    COUNT(DISTINCT CASE
        WHEN bce.entry_id IS NOT NULL THEN bcv.pstn_id
        ELSE NULL
    END) AS counted_booths
FROM ward_ballot_layout AS bl
INNER JOIN ward_ballots_master AS bm
    ON bm.ballot_id = bl.ballot_id
INNER JOIN wards AS w
    ON w.ward_id = bm.ward_id
LEFT JOIN candidates AS c
    ON c.candidate_id = bl.candidate_id
LEFT JOIN political_parties AS p
    ON p.party_id = c.party_id
LEFT JOIN booth_candidate_votes AS bcv
    ON bcv.layout_id = bl.layout_id
    AND bcv.ballot_id = bl.ballot_id
    AND bcv.ward_id = bm.ward_id
LEFT JOIN booth_counting_entry AS bce
    ON bce.entry_id = bcv.entry_id
    AND bce.pstn_id = bcv.pstn_id
    AND (
        (w.ward_type IN ('PANCHAYAT_SAMITI', 'GRAM_PANCHAYAT') AND bce.status_ps = 'VERIFIED_BY_RO')
        OR (w.ward_type = 'ZILA_PARISHAD' AND bce.status_zp = 'VERIFIED_BY_HQ')
    )
GROUP BY
    bl.ballot_id,
    bl.layout_id,
    bm.ward_id,
    bl.candidate_id,
    c.party_id,
    p.party_name,
    p.party_nameh,
    bl.symbol_id,
    bl.printed_symbol_name,
    bl.printed_symbol_image,
    bl.ballot_position,
    bl.printed_name_en,
    bl.printed_name_hi,
    bl.is_nota,
    c.nomination_status;

CREATE OR REPLACE
    ALGORITHM = UNDEFINED
    SQL SECURITY INVOKER
VIEW vw_ward_live_standings AS
SELECT
    standings.ward_id,
    standings.ward_type,
    standings.ps_code,
    standings.zp_code,
    standings.gp_code,
    standings.ward_no,
    standings.reservation_category,
    standings.total_booths,
    standings.counted_booths,
    standings.contesting_candidates,
    standings.leader_candidate_id,
    standings.leader_name,
    standings.leader_votes,
    standings.leader_is_nota,
    standings.runner_up_candidate_id,
    standings.runner_up_name,
    standings.runner_up_votes,
    CASE
        WHEN standings.leader_votes IS NULL OR standings.runner_up_votes IS NULL THEN NULL
        ELSE standings.leader_votes - standings.runner_up_votes
    END AS margin,
    CASE
        WHEN standings.contesting_candidates = 1 THEN 'UNOPPOSED'
        WHEN standings.status = 'LOCKED' THEN 'DECLARED'
        WHEN standings.counted_booths = 0 THEN 'NOT_STARTED'
        ELSE 'IN_PROGRESS'
    END AS display_status
FROM (
    SELECT
        w.ward_id,
        w.ward_type,
        w.ps_code,
        w.zp_code,
        w.gp_code,
        w.ward_no,
        w.reservation_category,
        w.total_booths,
        w.status,
        (
            SELECT COUNT(DISTINCT bce.pstn_id)
            FROM booth_counting_entry AS bce
            INNER JOIN mstpolstn AS booth
                ON booth.pstn_id = bce.pstn_id
            WHERE (
                (w.ward_type IN ('PANCHAYAT_SAMITI', 'GRAM_PANCHAYAT')
                    AND booth.ps_ward_id = w.ward_id
                    AND bce.status_ps = 'VERIFIED_BY_RO')
                OR (w.ward_type = 'ZILA_PARISHAD'
                    AND booth.zp_ward_id = w.ward_id
                    AND bce.status_zp = 'VERIFIED_BY_HQ')
            )
        ) AS counted_booths,
        (
            SELECT COUNT(*)
            FROM ward_ballot_layout AS ballot_candidate
            INNER JOIN ward_ballots_master AS ballot_master
                ON ballot_master.ballot_id = ballot_candidate.ballot_id
            WHERE ballot_master.ward_id = w.ward_id
                AND ballot_master.ballot_id = w.ballot_id
                AND ballot_candidate.is_nota = 0
        ) AS contesting_candidates,
        (
            SELECT tally.candidate_id
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1
        ) AS leader_candidate_id,
        (
            SELECT tally.candidate_name
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1
        ) AS leader_name,
        (
            SELECT tally.total_votes
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1
        ) AS leader_votes,
        (
            SELECT tally.is_nota
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1
        ) AS leader_is_nota,
        (
            SELECT tally.candidate_id
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1 OFFSET 1
        ) AS runner_up_candidate_id,
        (
            SELECT tally.candidate_name
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1 OFFSET 1
        ) AS runner_up_name,
        (
            SELECT tally.total_votes
            FROM vw_candidate_live_tallies AS tally
            WHERE tally.ward_id = w.ward_id
            ORDER BY tally.total_votes DESC, tally.ballot_position ASC
            LIMIT 1 OFFSET 1
        ) AS runner_up_votes
    FROM wards AS w
) AS standings;
