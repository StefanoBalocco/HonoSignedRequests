import { randomBytes, randomInt, Undefinedable } from './Common';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';

type SessionStorageLocalConfig = {
	maxSessions: number;
	maxSessionsPerUser: number;
};

export class SessionsStorageLocal implements SessionsStorage {
	private readonly _maxSessions: number;
	private readonly _maxSessionsPerUser: number;
	private readonly _cleanupSessionLimit: number;

	private _sessionsById: Map<number, Session> = new Map<number, Session>();
	private _sessionsByUserId: Map<number, Session[]> = new Map<number, Session[]>();

	constructor( options?: Partial<SessionStorageLocalConfig> ) {
		this._maxSessions = options?.maxSessions ?? 0xFFFF;
		this._maxSessionsPerUser = options?.maxSessionsPerUser ?? 3;
		this._cleanupSessionLimit = Math.floor( this._maxSessions * 0.75 );
	}

	async create( validityToken: number, tokenLength: number, userId: number ): Promise<Session> {
		let returnValue: Session;
		const now: number = Date.now();

		if( this._sessionsById.size > this._cleanupSessionLimit ) {
			await Promise.all(
				Array.from(
					this._sessionsById.entries()
				).filter(
					( [ _, session ]: [ number, Session ] ): boolean => now > ( session.lastUsed + validityToken )
				).map(
					( [ sessionId, _ ]: [ number, Session ] ): Promise<boolean> => this.delete( sessionId ) )
			);
		}

		const usedIds: number[] = [ ...this._sessionsById.keys() ].filter(
			( sessionId: number ): boolean => ( now <= ( this._sessionsById.get( sessionId )!.lastUsed + validityToken ) )
		).sort( ( a: number, b: number ): number => a - b );

		const sessionsRange: number = this._maxSessions - usedIds.length;
		if( sessionsRange > 0 ) {
			let sessionId: number = randomInt( 0, this._maxSessions - usedIds.length );

			let left: number = 0;
			let right: number = usedIds.length;
			while( left < right ) {
				const mid: number = Math.floor( ( left + right ) / 2 );
				if( usedIds[ mid ] <= sessionId + mid ) {
					left = mid + 1;
				} else {
					right = mid;
				}
			}
			sessionId = ( sessionId + left ) >>> 0;

			const session: Undefinedable<Session> = this._sessionsById.get( sessionId );
			if( session ) {
				if( now > session.lastUsed + validityToken ) {
					await this.delete( sessionId );
				} else {
					throw new Error( `Session ${ sessionId } already in use` );
				}
			}

			const token: Uint8Array<ArrayBuffer> = randomBytes( tokenLength );

			returnValue = {
				id: sessionId,
				userId,
				sequenceNumber: 1,
				token,
				lastUsed: now,
				data: []
			};
			this._sessionsById.set( sessionId, returnValue );

			const sessionsByUserId: Session[] = this._sessionsByUserId.get( userId ) ?? [];
			sessionsByUserId.push( returnValue );

			if( sessionsByUserId.length > this._maxSessionsPerUser ) {
				const oldestIndex = sessionsByUserId.reduce(
					( minimumIndex: number, session: Session, index: number ): number => session.lastUsed < sessionsByUserId[ minimumIndex ].lastUsed ? index : minimumIndex,
					0
				);
				const old: Session = sessionsByUserId.splice( oldestIndex, 1 )[ 0 ];
				this._sessionsById.delete( old.id );
			}
			this._sessionsByUserId.set( userId, sessionsByUserId );
		} else {
			throw new Error( `Session array full` );
		}

		return returnValue;
	}

	async delete( sessionId: number ): Promise<boolean> {
		let returnValue: boolean = false;
		const session: Undefinedable<Session> = this._sessionsById.get( sessionId );
		if( session ) {
			returnValue = true;
			this._sessionsById.delete( sessionId );
			const userSessions: Session[] = this._sessionsByUserId.get( session.userId ) ?? [];
			const sessionIndex: number = userSessions.findIndex( ( session: Session ): boolean => session.id === sessionId );
			if( -1 !== sessionIndex ) {
				userSessions.splice( sessionIndex, 1 );
			}
		}
		return returnValue;
	}

	async getByUserId( userId: number ): Promise<Session[]> {
		return this._sessionsByUserId.get( userId ) ?? [];
	}

	async get( sessionId: number ): Promise<Undefinedable<Session>> {
		return this._sessionsById.get( sessionId );
	}
}