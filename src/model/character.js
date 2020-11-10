// "mob" or mobile entities. this includes characters and players.

const Entity = require('./entity');
const directions = require('./directions');

// used to calculate a direction based on a change in coordinates. use
// deltaDirections[deltaX + 1][deltaY + 1] to get a direction number.
const deltaDirections = [
    [directions.southWest, directions.west, directions.northWest],
    [directions.south, null, directions.north],
    [directions.southEast, directions.east, directions.northEast]
];

class Character extends Entity {
    constructor(world) {
        super(world);

        // direction number we're facing
        this.direction = 0;

        // the character we're fighting
        this.opponent = null;

        this.fightStage = -1;

        // the character we're talking to
        this.interlocutor = null;

        this.chasing = null;

        // can we move? certain NPCs still have conversation partners, but can
        // walk around (e.g. goblin generals in goblin diplomacy)
        this.locked = false;

        // animation IDs
        // see https://github.com/2003scape/rsc-config#configanimations
        this.animations = [];
        this.animations.length = 12;
        this.animations.fill(0, this.animations.length);

        // used to calculate who should get the drop
        // { player.id: damage }
        this.playerDamage = new Map();
    }

    lock() {
        this.locked = true;
    }

    unlock() {
        this.locked = false;
    }

    damage(damage, player) {
        if (player) {
            const totalDamage = this.playerDamage.get(player.id) || 0;
            this.playerDamage.set(player.id, totalDamage + damage);
        }

        this.skills.hits.current -= damage;

        if (this.skills.hits.current <= 0) {
            this.die();
            return;
        }

        this.broadcastDamage(damage);
    }

    faceDirection(deltaX, deltaY) {
        const direction = deltaDirections[deltaX + 1][deltaY + 1];

        if (this.direction === direction) {
            return this.direction;
        }

        this.direction = deltaDirections[deltaX + 1][deltaY + 1];
        this.broadcastDirection();
        return this.direction;
    }

    // set our direction to face an entity (when we talk to an NPC or pick up
    // a ground item for instance)
    faceEntity(entity) {
        if (this.x === entity.x && this.y === entity.y) {
            if (entity.direction === 0) {
                this.direction = 0;
            } else if (entity.direction === 1) {
                this.direction = 6;
            }

            return this.direction;
        }

        let deltaX = this.x - entity.x;

        if (deltaX > 0) {
            deltaX = 1;
        } else if (deltaX < 0) {
            deltaX = -1;
        }

        let deltaY = this.y - entity.y;

        if (deltaY > 0) {
            deltaY = 1;
        } else if (deltaY < 0) {
            deltaY = -1;
        }

        this.direction = deltaDirections[deltaX + 1][deltaY + 1];
        this.broadcastDirection();
        return this.direction;
    }

    // face and set our engager to this character, as well as busy status
    engage(character) {
        this.faceEntity(character);
        this.lock();
        this.interlocutor = character;

        character.faceEntity(this);
        character.lock();
        character.interlocutor = this;
    }

    // free both characters from busy states and conversational partner lock
    disengage() {
        this.unlock();

        if (this.interlocutor) {
            this.interlocutor.unlock();
            this.interlocutor.interlocutor = null;
            this.interlocutor = null;
        }
    }

    async attack(character) {
        const deltaX = character.x - this.x;
        const deltaY = character.y - this.y;

        if (deltaX !== 0 || deltaY !== 0) {
            await this.chase(character);
        }

        this.lock();
        this.opponent = character;
        this.combatRounds = 0;
        this.fightStage = 0;
        this.direction = 9;
        this.broadcastDirection();

        character.lock();
        character.opponent = this;
        character.combatRounds = 0;
        character.fightStage = 1;
        character.direction = 8;
        character.broadcastDirection();
    }

    async retreat() {
        const { world } = this;

        this.unlock();
        this.fightStage = -1;
        this.direction = 0;

        this.opponent.fightStage = -1;
        this.opponent.direction = 0;
        this.opponent.broadcastDirection();
        this.opponent.opponent = null;

        await world.sleepTicks(1);

        this.opponent.unlock();
        this.opponent = null;
    }

    // collision detection for players and NPCs to determine if next step is
    // valid
    canWalk(deltaX, deltaY) {
        // if this returns true, the character gets added to the players' moved
        // entity lists, and desyncs from the server by moving an extra tile
        if (deltaX === 0 && deltaY === 0) {
            return false;
        }

        const destX = this.x + deltaX;
        const destY = this.y + deltaY;

        // attackable? npcs always break our path
        const npcs = this.world.npcs.getAtPoint(destX, destY);

        for (const npc of npcs) {
            if (npc.definition.hostility) {
                return false;
            }
        }

        return this.world.pathFinder.isValidGameStep(
            { x: this.x, y: this.y },
            { deltaX, deltaY }
        );
    }

    walkTo(deltaX, deltaY) {
        const oldX = this.x;
        const oldY = this.y;

        this.x += deltaX;
        this.y += deltaY;

        this.faceDirection(oldX - this.x, oldY - this.y);
        this.broadcastMove();
    }

    async walkToPosition(destX, destY, overlap = true) {
        const { world } = this;

        const path = world.pathFinder.getLineOfSight(
            { x: this.x, y: this.y },
            { x: destX, y: destY }
        );

        if (overlap) {
            path.push({ x: destX, y: destY });
        }

        let x = this.x;
        let y = this.y;

        for (const { x: stepX, y: stepY } of path) {
            if (stepX === this.x && stepY === this.y) {
                continue;
            }

            const deltaX = stepX - x;
            const deltaY = stepY - y;

            const validStep = world.pathFinder.isValidGameStep(
                { x, y },
                { deltaX, deltaY }
            );

            if (validStep) {
                if (!this.walkQueue.length) {
                    this.walkTo(deltaX, deltaY);
                    await world.sleepTicks(1);
                }
            } else {
                break;
            }

            x += deltaX;
            y += deltaY;
        }
    }

    async chase(entity) {
        this.chasing = entity;
        await this.walkToPosition(entity.x, entity.y, true);
        this.chasing = null;
    }
}

module.exports = Character;
