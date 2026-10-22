module sui_claim_anchoring::verified_claim_registry;

use std::option::{Self, Option};
use std::vector;
use sui::clock::{Self, Clock};
use sui::dynamic_field as df;
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const E_INVALID_HASH_LENGTH: u64 = 0;
const E_INVALID_SCHEMA_VERSION: u64 = 1;
const E_ANCHOR_ALREADY_EXISTS: u64 = 2;
const E_INVALID_ADMIN_CAP: u64 = 3;

/// Shared parent object stores one immutable commitment per (session, claim).
public struct Registry has key {
    id: UID,
}

/// Possession of this publisher-owned capability authorizes anchoring.
public struct AdminCap has key, store {
    id: UID,
    registry_id: ID,
}

/// Dynamic-field key. The session hash is SHA-256 of the TraceForge session/run identity.
public struct AnchorKey has copy, drop, store {
    session_hash: vector<u8>,
    claim_index: u32,
}

/// Only hashes and public audit metadata are stored on Sui; claim/evidence contents stay off-chain.
public struct AnchorRecord has copy, drop, store {
    session_hash: vector<u8>,
    claim_index: u32,
    manifest_hash: vector<u8>,
    evidence_root: vector<u8>,
    schema_version: u32,
    anchored_at_ms: u64,
    anchored_by: address,
    verified: bool,
}

/// Emitted when the registry is created during package publication.
public struct RegistryCreated has copy, drop {
    registry_id: ID,
}

/// Public receipt data can be located in Sui event queries and explorers.
public struct ClaimAnchored has copy, drop {
    registry_id: ID,
    session_hash: vector<u8>,
    claim_index: u32,
    manifest_hash: vector<u8>,
    evidence_root: vector<u8>,
    schema_version: u32,
    anchored_at_ms: u64,
    anchored_by: address,
    verified: bool,
}

fun init(ctx: &mut TxContext) {
    let registry = Registry { id: object::new(ctx) };
    let registry_id = object::id(&registry);
    let admin_cap = AdminCap {
        id: object::new(ctx),
        registry_id: copy registry_id,
    };

    event::emit(RegistryCreated { registry_id });
    transfer::share_object(registry);
    transfer::transfer(admin_cap, tx_context::sender(ctx));
}

/// Record a verified-claim attestation. The admin capability is intentionally
/// required so arbitrary callers cannot label unverified data as verified.
public fun anchor_verified_claim(
    registry: &mut Registry,
    admin_cap: &AdminCap,
    clock: &Clock,
    session_hash: vector<u8>,
    claim_index: u32,
    manifest_hash: vector<u8>,
    evidence_root: vector<u8>,
    schema_version: u32,
    ctx: &mut TxContext,
) {
    assert!(admin_cap.registry_id == object::id(registry), E_INVALID_ADMIN_CAP);
    assert!(vector::length(&session_hash) == 32, E_INVALID_HASH_LENGTH);
    assert!(vector::length(&manifest_hash) == 32, E_INVALID_HASH_LENGTH);
    assert!(vector::length(&evidence_root) == 32, E_INVALID_HASH_LENGTH);
    assert!(schema_version > 0, E_INVALID_SCHEMA_VERSION);

    let key = AnchorKey {
        session_hash: copy session_hash,
        claim_index,
    };
    assert!(
        !df::exists(&registry.id, AnchorKey {
            session_hash: copy session_hash,
            claim_index,
        }),
        E_ANCHOR_ALREADY_EXISTS,
    );

    let anchored_at_ms = clock::timestamp_ms(clock);
    let anchored_by = tx_context::sender(ctx);
    let record = AnchorRecord {
        session_hash: copy session_hash,
        claim_index,
        manifest_hash: copy manifest_hash,
        evidence_root: copy evidence_root,
        schema_version,
        anchored_at_ms,
        anchored_by,
        verified: true,
    };

    df::add(&mut registry.id, key, record);
    event::emit(ClaimAnchored {
        registry_id: object::id(registry),
        session_hash,
        claim_index,
        manifest_hash,
        evidence_root,
        schema_version,
        anchored_at_ms,
        anchored_by,
        verified: true,
    });
}

/// Read a stored record through Sui's read-only/dev-inspect call path.
public fun get_anchor(
    registry: &Registry,
    session_hash: vector<u8>,
    claim_index: u32,
): Option<AnchorRecord> {
    let exists = df::exists(&registry.id, AnchorKey {
        session_hash: copy session_hash,
        claim_index,
    });
    if (!exists) return option::none();

    let record = df::borrow(&registry.id, AnchorKey {
        session_hash,
        claim_index,
    });
    option::some(*record)
}

#[test]
fun test_anchor_and_read_record() {
    let mut ctx = tx_context::dummy();
    let mut registry = Registry { id: object::new(&mut ctx) };
    let admin_cap = AdminCap {
        id: object::new(&mut ctx),
        registry_id: object::id(&registry),
    };
    let clock = clock::create_for_testing(&mut ctx);
    let session_hash = test_hash(32, 1);
    let manifest_hash = test_hash(32, 2);
    let evidence_root = test_hash(32, 3);

    anchor_verified_claim(
        &mut registry,
        &admin_cap,
        &clock,
        copy session_hash,
        7,
        copy manifest_hash,
        copy evidence_root,
        1,
        &mut ctx,
    );

    let found = get_anchor(&registry, session_hash, 7);
    assert!(option::is_some(&found), 10);
    let record = option::borrow(&found);
    assert!(record.claim_index == 7, 11);
    assert!(record.manifest_hash == manifest_hash, 12);
    assert!(record.evidence_root == evidence_root, 13);
    assert!(record.verified, 14);

    clock.destroy_for_testing();
    let _removed: AnchorRecord = df::remove(&mut registry.id, AnchorKey {
        session_hash: test_hash(32, 1),
        claim_index: 7,
    });
    let Registry { id: registry_uid } = registry;
    let AdminCap { id: admin_cap_uid, registry_id: _ } = admin_cap;
    object::delete(registry_uid);
    object::delete(admin_cap_uid);
}

#[test]
#[expected_failure(abort_code = 0)]
fun test_rejects_non_bytes32_hash() {
    let mut ctx = tx_context::dummy();
    let mut registry = Registry { id: object::new(&mut ctx) };
    let admin_cap = AdminCap {
        id: object::new(&mut ctx),
        registry_id: object::id(&registry),
    };
    let clock = clock::create_for_testing(&mut ctx);

    anchor_verified_claim(
        &mut registry,
        &admin_cap,
        &clock,
        test_hash(31, 1),
        0,
        test_hash(32, 2),
        test_hash(32, 3),
        1,
        &mut ctx,
    );

    clock::destroy_for_testing(clock);
    let Registry { id: registry_uid } = registry;
    let AdminCap { id: admin_cap_uid, registry_id: _ } = admin_cap;
    object::delete(registry_uid);
    object::delete(admin_cap_uid);
}

#[test]
#[expected_failure(abort_code = 2)]
fun test_rejects_duplicate_claim_anchor() {
    let mut ctx = tx_context::dummy();
    let mut registry = Registry { id: object::new(&mut ctx) };
    let admin_cap = AdminCap {
        id: object::new(&mut ctx),
        registry_id: object::id(&registry),
    };
    let clock = clock::create_for_testing(&mut ctx);
    let session_hash = test_hash(32, 1);
    let manifest_hash = test_hash(32, 2);
    let evidence_root = test_hash(32, 3);

    anchor_verified_claim(
        &mut registry,
        &admin_cap,
        &clock,
        copy session_hash,
        7,
        copy manifest_hash,
        copy evidence_root,
        1,
        &mut ctx,
    );
    anchor_verified_claim(
        &mut registry,
        &admin_cap,
        &clock,
        session_hash,
        7,
        manifest_hash,
        evidence_root,
        1,
        &mut ctx,
    );

    clock::destroy_for_testing(clock);
    let _record: AnchorRecord = df::remove(&mut registry.id, AnchorKey {
        session_hash: test_hash(32, 1),
        claim_index: 7,
    });
    let Registry { id: registry_uid } = registry;
    let AdminCap { id: admin_cap_uid, registry_id: _ } = admin_cap;
    object::delete(registry_uid);
    object::delete(admin_cap_uid);
}

#[test_only]
fun test_hash(length: u64, byte: u8): vector<u8> {
    let mut result = vector[];
    let mut index = 0;
    while (index < length) {
        vector::push_back(&mut result, byte);
        index = index + 1;
    };
    result
}
