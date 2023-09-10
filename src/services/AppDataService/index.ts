import { BehaviorSubject, Observable } from 'rxjs';
import { useConfigStore } from '../../store/config';
import { useServerStore } from '../../store/server';
import { useWorkspaceStore } from '../../store/workspace';

/**
 * Get app stores in wiki.
 */
export class AppDataService {
  #serverStore = useServerStore;
  #configStore = useConfigStore;
  #wikiStore = useWorkspaceStore;

  // Using BehaviorSubject to manage and emit state changes as Observables
  #serverSubject = new BehaviorSubject(this.#serverStore.getState());
  #configSubject = new BehaviorSubject(this.#configStore.getState());
  #wikiSubject = new BehaviorSubject(this.#wikiStore.getState());

  constructor() {
    // Subscribe to store changes and update the BehaviorSubject accordingly
    this.#serverStore.subscribe(state => {
      this.#serverSubject.next(state);
    });
    this.#configStore.subscribe(state => {
      this.#configSubject.next(state);
    });
    this.#wikiStore.subscribe(state => {
      this.#wikiSubject.next(state);
    });
  }

  /**
   * Gets the current state of the server store.
   *
   * @returns The current state of the server store.
   */
  getServerState() {
    return this.#serverStore.getState();
  }

  /**
   * Gets the current state of the config store.
   *
   * @returns The current state of the config store.
   */
  getConfigState() {
    return this.#configStore.getState();
  }

  /**
   * Gets the current state of the wiki store.
   *
   * @returns The current state of the wiki store.
   */
  getWikiState() {
    return this.#wikiStore.getState();
  }

  /**
   * Returns an Observable to the server store changes.
   *
   * @returns Observable of the server store state.
   */
  $getServerState(): Observable<ReturnType<typeof useServerStore.getState>> {
    return this.#serverSubject.asObservable();
  }

  /**
   * Returns an Observable to the config store changes.
   *
   * @returns Observable of the config store state.
   */
  $getConfigState(): Observable<ReturnType<typeof useConfigStore.getState>> {
    return this.#configSubject.asObservable();
  }

  /**
   * Returns an Observable to the wiki store changes.
   *
   * @returns Observable of the wiki store state.
   */
  $getWikiState(): Observable<ReturnType<typeof useWorkspaceStore.getState>> {
    return this.#wikiSubject.asObservable();
  }
}

/**
 * Only need a singleton instance for all wikis.
 */
export const appDataService = new AppDataService();
