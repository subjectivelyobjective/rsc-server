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

        // the character we're talking to
        this.interlocutor = null;

        // can we move? certain NPCs still have conversation partners, but can
        // walk around (e.g. goblin generals in goblin diplomacy)
        this.locked = false;

        // animation IDs
        // see https://github.com/2003scape/rsc-config#configanimations
        this.animations = [];
        this.animations.length = 12;
        this.animations.fill(0, this.animations.length);
    }

    lock() {
        this.locked = true;
    }

    unlock() {
        this.locked = false;
    }

    faceDirection(deltaX, deltaY) {
        const direction = deltaDirections[deltaX + 1][deltaY + 1];

        if (this.direction === direction) {
            return this.direction;
        }

        this.direction = deltaDirections[deltaX + 1][deltaY + 1];
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

        // npcs always break our path
        if (this.world.npcs.getAtPoint(destX, destY).length) {
            return false;
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
    }

    async chase(entity) {
        const { world } = this;

        const path = world.pathFinder.getLineOfSight(
            { x: this.x, y: this.y },
            { x: entity.x, y: entity.y }
        );

        let x = this.x;
        let y = this.y;

        for (const { x: stepX, y: stepY } of path) {
            if (stepX === this.x && stepY === this.y) {
                continue;
            }

            const deltaX = stepX - x;
            const deltaY = stepY - y;

            if (
                world.pathFinder.isValidGameStep({ x, y }, { deltaX, deltaY })
            ) {
                this.walkTo(deltaX, deltaY);
                await world.sleepTicks(1);
            } else {
                break;
            }

            x += deltaX;
            y += deltaY;
        }
    }

}

module.exports = Character;
